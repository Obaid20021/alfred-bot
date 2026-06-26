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

// قائمة تفقدية سريعة بالكلمات المرفوضة تماماً لتوفير استهلاك الـ AI
const BLACKLISTED_WORDS = ['كلب', 'حمار', 'يلعن', 'تفو', 'يا ابن', 'منيوك', 'قحبة'];

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
- ممنوع منعاً باتاً وضع إيموجيات مخصصة نصية مشوهة.
- لا تخترع منشنات أو علامات @ من عندك أبداً.`;

// ===== دالة فحص وتدقيق السلوك تلقائياً (نسخة خفيفة ومحمية ضد الحظر) =====
async function checkMessageSafety(userMessage) {
  // 1. الفلترة المحلية الفورية لتوفير الطلبات
  const hasBadWord = BLACKLISTED_WORDS.some(word => userMessage.includes(word));
  if (hasBadWord) return true;

  // 2. إذا كانت الرسالة عادية جداً وقصيرة لا داعي لطلب الـ AI
  if (userMessage.length < 3 || userMessage.includes('هههه') || userMessage.includes('كيف حالك')) {
    return false;
  }

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama3-8b-8192', // نموذج خفيف وسريع وموفر جداً لحصص الاستهلاك
      messages: [
        {
          role: 'system',
          content: `You are a strict text moderator. Analyze if the text contains severe insults, cursing, or toxic behavior. Respond with ONLY 'BAD' or 'GOOD'.`
        },
        { role: 'user', content: userMessage }
      ],
      max_tokens: 3,
      temperature: 0.1,
    });

    const result = completion.choices[0].message.content.trim().toUpperCase();
    return result.includes('BAD');
  } catch (error) {
    // إذا واجه البوت ضغط طلبات أو خطأ، يتجاوز الرسالة تلقائياً لكي لا يعلق الروم
    console.error('Safety Check Rate Limit or Error:', error.message);
    return false;
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
    console.error('Alfred Groq Error:', error.message);
    // رسالة مرنة في حال الضغط المؤقت على الـ API
    return 'معذرة يا سيدي، الضغط مرتفع على شبكة الاتصال، لكنني متواجد لخدمتك دائماً.';
  }
}

function addWarn(userId, reason, by) {
  if (!warnData[userId]) warnData[userId] = [];
  warnData[userId].push({ reason, by, date: new Date().toLocaleDateString('ar-SA') });
  return warnData[userId].length;
}

async function executePunishment(message, targetUser, reason) {
  const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);
  const count = addWarn(targetUser.id, reason, 'نظام قصر واين التلقائي');

  await message.channel.send(
    `⚠️ **تنبيه حازم من ألفريد:** العضو <@${targetUser.id}>، تم رصد سلوك خارج عن حدود اللياقة بقوانين السيرفر.\n📋 **السبب:** ${reason}\n🔢 **مجموع التحذيرات:** ${count}/3`
  );

  if (count >= 3 && targetMember) {
    try {
      await targetMember.timeout(60 * 60_000, 'تجاوز حد التحذيرات المسموح (3/3)');
      await message.channel.send(`🔇 *لقد قمت بنقل العضو <@${targetUser.id}> لغرفة الاحتجاز مؤقتاً لتجاوزه اللوائح المعتمدة، يا سيدي بروس.*`);
    } catch {
      await message.channel.send('🚨 معذرةً يا سيدي، لا أمتلك الصلاحيات الكافية لتطبيق عقوبة الكتم المباشر.');
    }
  }
}

client.once('ready', () => {
  console.log('Alfred Pennyworth is fixed and perfectly optimized! 🤵‍♂️🛡️');
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  let cleanContent = message.content.trim();
  const isPrivileged = message.author.id === BRUCE_ID || message.author.id === MOHAMMED_ID;

  // =====================================================================
  // 🛡️ الفحص التلقائي المستمر الذكي (محمي ضد الـ Rate Limits)
  // =====================================================================
  if (!isPrivileged && cleanContent.length > 0) {
    const isBadBehavior = await checkMessageSafety(cleanContent);
    if (isBadBehavior) {
      await executePunishment(message, message.author, `استخدام عبارات غير لائقة في قنوات القصر`);
      return; 
    }
  }

  // =====================================================================
  // 🔥 ميزة الـ Reply اليدوية عند كتابة "تحذير"
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
        console.error('Alfred Manual-Warn Error:', err);
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
    } catch (e) {}
  }

  if (!isMentioned && !isReplyToAlfred) return;

  let userMessage = cleanContent.replace(`<@${client.user.id}>`, '').trim();
  if (!userMessage) {
    return message.reply("تحت أمرك يا سيدي بروس، كيف يمكنني مساعدتك اليوم؟");
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
  }, 1500);
});

client.login(process.env.ALFRED_TOKEN);