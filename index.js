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
const BRUCE_ID = '648818494808391696';     // باتمان (بروس واين)
const JOKER_ID = '1052545362533023754';     // الجوكر
const CATWOMAN_ID = '112233445566778899';  // كاتوومان (سيلينا)

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
- لا تخترع منشنات أو علامات @ من عندك أبداً.`;

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
    
    // تنظيف الرد من أي محاولات منشن وهمية يخترعها الـ AI
    reply = reply.replace(/<@!?\d+>/g, '').replace(/@\w+/g, '').trim();

    alfredConversations[channelId].push({ role: 'assistant', content: reply });
    return reply;
  } catch (error) {
    console.error('Alfred Groq Error:', error);
    return 'معذرة يا سيدي، يبدو أن هناك عطلاً في شبكة الاتصالات الداخلية للقصر.';
  }
}

client.once('ready', () => {
  console.log('Alfred Pennyworth is at your service. 🤵‍♂️☕');
});

client.on('messageCreate', async message => {
  // 🛑 الفلتر الأهم: منع البوت من الرد على البوتات أو على نفسه نهائياً لمنع اللوب
  if (message.author.bot) return;
  if (!message.guild) return;

  let cleanContent = message.content.trim();

  // التحقق من شروط الرد (هل أرسلوا منشن لألفريد، أو عملوا Reply على رسالة سابقة لألفريد؟)
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

  // إذا لم يكن هناك منشن ولم يكن رداً مباشراً على ألفريد، يتجاهل الشات تماماً
  if (!isMentioned && !isReplyToAlfred) return;

  // إزالة منشن البوت لكي لا يخرب سياق الفهم للذكاء الاصطناعي
  let userMessage = cleanContent.replace(`<@${client.user.id}>`, '').trim();

  if (!userMessage) {
    return message.reply("تحت أمرك يا سيدي، كيف يمكنني مساعدتك اليوم؟");
  }

  await message.channel.sendTyping();

  // محاكاة تأخير بشري خفيف ووقور للرد مع تمرير دقيق لبيانات مرسل الرسالة الفعلي
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
