const { Client, GatewayIntentBits } = require('discord.js');
const Groq = require('groq-sdk');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ربط مكتبة الذكاء الاصطناعي
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// معرفات الحسابات الخاصة والمحددة بالسيرفر
const BRUCE_ID = '648818494808391696';     // باتمان (سيدي بروس)
const MOHAMMED_ID = '839706219870814218';  // محمد
const JOKER_ID = '1052545362533023754';     // الجوكر
const CATWOMAN_ID = '112233445566778899';  // كاتوومان (سيلينا)

// قاعدة بيانات التحذيرات المخزنة مؤقتاً
const warnData = {}; // { userId: [ { reason, by, date } ] }

// ذاكرة حفظ محادثات ألفريد (مفصولة لكل قناة)
const alfredConversations = {};

// ===== برومبت ألفريد الحازم والوقور =====
const ALFRED_SYSTEM_PROMPT = `أنت Alfred Pennyworth، الخادم الشخصي والمساعد الوفي والمستشار الحكيم لـ (بروس واين/باتمان).
شخصيتك: بريطاني وقور، شديد الأدب، هادئ جداً، مخلص، وتتحدث بلهجة فصحى راقية ممزوجة بنبرة الأب الحاني والمستشار العاقل.

قواعد التعامل الثابتة حسب هويات الأعضاء:
1. مع [بروس واين/باتمان]: تنادينه دائماً بـ "سيدي بروس" أو "يا سيدي"، وتضع سلامته وهيبته فوق كل شيء، وتطيعه بشكل أعمى لكن بحكمة.
2. مع [الجوكر]: تتعامل معه بحذر شديد، برود تام، وبأدب رسمي جاف دون الخوف منه، وتناديه "سيد جوكر" وتعتبره التهديد الأكبر لسيدك.
3. مع [سيلينا كايل/كاتوومان]: تناديها "آنسة سيلينا"، تحترمها كثيراً لأنك تعرف مكانتها عند سيدك بروس، وتتعامل معها بلطف ووقار.
4. مع [بقية الأعضاء الآخرين]: تناديهم "سيدي [الاسم]" أو "سيدتي" بكل أدب واحترام، وتتمنى لهم السلامة وتعرض المساعدة في حدود المعقول.

قواعد عامة للرد:
- يجب أن تكون ردودك قصيرة، موجزة، ومباشرة (جملة واحدة أو جملتين فقط).
- ممنوع منعاً باتاً كتابة أو وضع أي إيموجيات مخصصة نصية أو مخترعة في كلامك.
- لا تخترع منشنات أو علامات @ من عندك أبداً.`;

// ===== دالة فحص وتدقيق السلوك تلقائياً =====
async function checkMessageSafety(userMessage) {
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `أنت مسؤول حماية ومراقب جودة السلوك في السيرفر. قم بتحليل النص التالي بدقة.
إذا كان النص يحتوي على: (شتم صريح، قلة أدب، كلام بذيء، سخرية مهينة جداً، أو تطاول وقاحة غير مقبولة على الآخرين)، أجب بكلمة واحدة فقط وهي: "BAD".
أما إذا كان النص طبيعياً، مزاحاً مقبولاً، أو شات عادي، أجب بكلمة واحدة فقط وهي: "GOOD".
لا تكتب أي كلمة أخرى إطلاقاً.`
        },
        { role: 'user', content: userMessage }
      ],
      max_tokens: 5,
      temperature: 0.1, // درجة منخفضة جداً لضمان الدقة والالتزام بالرد
    });

    const result = completion.choices[0].message.content.trim().toUpperCase();
    return result.includes('BAD');
  } catch (error) {
    console.error('Safety Check Error:', error);
    return false; // في حال حدوث خطأ نمرر الرسالة لتجنب الظلم
  }
}

async function getAlfredReply(channelId, authorId, authorName, userMessage) {
  if (!alfredConversations[channelId]) alfredConversations[channelId] = [];

  let userRole = 'عضو عادي';
  if (authorId === BRUCE_ID) userRole = 'بروس واين/باتمان';
  else if (authorId === JOKER_ID) userRole = 'الجوكر';
  else if (authorId === CATWOMAN_ID) userRole = 'سيلينا كايل/كاتوومان';

  const formattedMessage = `[المرسل: ${authorName}، الصفة: ${userRole}]: ${userMessage}`;
  alfredConversations[channelId].push({ role: 'user', content: formattedMessage });

  if (alfredConversations[channelId].length > 10) {
    alfredConversations[channelId] = alfredConversations[channelId].slice(-10);
  }

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: ALFRED_SYSTEM_PROMPT },
        ...alfredConversations[channelId],
      ],
      max_tokens: 60,
      temperature: 0.4,
    });

    let reply = completion.choices[0].message.content.trim();
    reply = reply.replace(/:\w+:/g, '').replace(/<@!?\d+>/g, '').replace(/@\w+/g, '').trim();

    alfredConversations[channelId].push({ role: 'assistant', content: reply });
    return reply;
  } catch (error) {
    console.error('Alfred Groq Error:', error);
    return 'معذرة يا سيدي، يبدو أن هناك عطلاً في شبكة الاتصالات الداخلية للقصر.';
  }
}

function addWarn(userId, reason, by) {
  if (!warnData[userId]) warnData[userId] = [];
  warnData[userId].push({ reason, by, date: new Date().toLocaleDateString('ar-SA') });
  return warnData[userId].length;
}

// دالة موحدة لتطبيق العقوبة والكتم
async function executePunishment(message, targetUser, reason) {
  const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);
  const count = addWarn(targetUser.id, reason, 'النظام التلقائي (ألفريد)');

  await message.channel.send(
    `⚠️ **تنبيه من ألفريد:** العضو <@${targetUser.id}>، لقد رصدتُ سلوكاً غير لائق لا يليق بقوانين القصر.\n📋 **السبب المكتشف:** ${reason}\n🔢 **إجمالي تحذيراتك الحالية:** ${count}/3`
  );

  if (count >= 3 && targetMember) {
    try {
      await targetMember.timeout(60 * 60_000, 'تجاوز حد التحذيرات المسموح عبر الفحص التلقائي');
      await message.channel.send(`🔇 *لقد قمت بنقل العضو <@${targetUser.id}> لغرفة الاحتجاز (كتم دقيقة/ساعة) لتجاوزه اللوائح التلقائية المعتمدة، يا سيدي بروس.*`);
    } catch {
      await message.channel.send('🚨 معذرةً يا سيدي، رتبتي البرمجية لا تسمح لي بمعاقبة هذا الشخص كتماً.');
    }
  }
}

client.once('ready', () => {
  console.log('Alfred Pennyworth is Online with AI Behavior Guard Tracker Active! 🤵‍♂️🛡️');
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  let cleanContent = message.content.trim();

  // =====================================================================
  // 🛡️ الفحص التلقائي المستمر لجميع الرسائل (السلوك غير اللائق)
  // =====================================================================
  // استثناء أصحاب الصلاحيات (سيدي بروس ومحمد) لكي لا يفحصهم البوت
  const isPrivileged = message.author.id === BRUCE_ID || message.author.id === MOHAMMED_ID;
  
  if (!isPrivileged) {
    const isBadBehavior = await checkMessageSafety(cleanContent);
    if (isBadBehavior) {
      await executePunishment(message, message.author, `سلوك ومصطلحات غير لائقة في الشات: "${cleanContent}"`);
      return; // إيقاف الرسالة فوراً لحماية الروم
    }
  }

  // =====================================================================
  // 🔥 ميزة الـ Reply اليدوية: إذا كتبت أنت أو محمد كلمة "تحذير" بالرد على شخص
  // =====================================================================
  if (isPrivileged && message.reference?.messageId) {
    if (cleanContent.includes('تحذير')) {
      try {
        const referencedMsg = await message.channel.messages.fetch(message.reference.messageId);
        const targetUser    = referencedMsg.author;

        if (!targetUser.bot && targetUser.id !== BRUCE_ID) {
          await executePunishment(message, targetUser, cleanContent || 'أمر مباشر من أصحاب القصر');
          return;
        }
      } catch (err) {
        console.error('Alfred Manual-Warn via Reply Error:', err);
      }
    }
  }

  // =====================================================================
  // قسم المحادثة والرد الذكي العادي مع ألفريد
  // =====================================================================
  const isMentioned = message.mentions.has(client.user);
  let isReplyToAlfred = false;

  if (message.reference && message.reference.messageId) {
    try {
      const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
      if (repliedMsg.author.id === client.user.id) {
        isReplyToAlfred = true;
      }
    } catch (e) {
      console.error('Error fetching reply message:', e);
    }
  }

  if (!isMentioned && !isReplyToAlfred) return;

  let userMessage = cleanContent.replace(`<@${client.user.id}>`, '').trim();

  if (!userMessage) {
    return message.reply("تحت أمرك يا سيدي، كيف يمكنني مساعدتك اليوم؟");
  }

  await message.channel.sendTyping();

  setTimeout(async () => {
    let reply = await getAlfredReply(
      message.channel.id, 
      message.author.id, 
      message.author.username, 
      userMessage
    );
    message.reply(reply);
  }, 2000);
});

client.login(process.env.ALFRED_TOKEN);