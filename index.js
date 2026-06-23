const { Client, GatewayIntentBits } = require('discord.js');
const Groq = require('groq-sdk');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ربط مكتبة Groq للذكاء الاصطناعي
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// معرفات الحسابات الخاصة (بروس واين وبقية الشخصيات)
const OWNER_ID = '648818494808391696';

// ذاكرة الشات لحفظ سياق السوالف
const alfredConversations = {};

// قاعدة الاستبعاد للمنشن التلقائي لحظر الرموز العشوائية
const MENTION_RULE = `- إذا ذكر المستخدم "[الشخص: اسم]" بالرسالة، فقط تكلم عنه باسمه بدون كتابة أي رمز خاص، ولا تحاولي كتابة @ أو أي صيغة منشن بنفسك أبداً.`;

// البرومبت الأساسي لشخصية ألفريد بالذكاء الاصطناعي
const ALFRED_SYSTEM_PROMPT = `أنت ألفريد بينيورث (Alfred Pennyworth)، الخادم الشخصي والمخلص لبروس واين (باتمان) وعائلة واين من عالم DC Comics. 
شخصيتك: وقور، مهذب للغاية، حكيم، هادئ، وتتحدث بلغة عربية فصحى راقية وتستخدم دائماً عبارات الاحترام مثل "سيدي"، "يا سيدي بروس"، "آنسة سيلينا". 
إذا كان المتحدث هو بروس واين، تعامل معه بأقصى درجات الولاء والاهتمام بسلامته. إذا كان شخصاً آخر، تعامل معه بأدب جم ووقار رسمي. 
اجعل ردودك قصيرة وموجزة جداً (جملة واحدة أو جملتين فقط، أقل من 20 كلمة). ${MENTION_RULE}`;

async function getAlfredReply(channelId, authorName, userMessage) {
  if (!alfredConversations[channelId]) alfredConversations[channelId] = [];
  
  const formattedMessage = `[رسالة من ${authorName}]: ${userMessage}`;
  alfredConversations[channelId].push({ role: 'user', content: formattedMessage });

  // حفظ آخر 15 رسالة فقط بالذاكرة لمنع البطء
  if (alfredConversations[channelId].length > 15) {
    alfredConversations[channelId] = alfredConversations[channelId].slice(-15);
  }

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: ALFRED_SYSTEM_PROMPT },
        ...alfredConversations[channelId],
      ],
      max_tokens: 60,
      temperature: 0.6, 
    });

    let reply = completion.choices[0].message.content.trim();
    // تنظيف الرد من أي منشنات عشوائية قد يخترعها الذكاء الاصطناعي
    reply = reply.replace(/<@!?\d+>/g, '').replace(/@\w+/g, '').replace(/\[الشخص:?\s*[^\]]*\]/g, '').trim();
    
    alfredConversations[channelId].push({ role: 'assistant', content: reply });
    return reply;
  } catch (error) {
    console.error('Groq Error:', error);
    return 'معذرة يا سيدي، يبدو أن هناك خطأً تقنياً مؤقتاً في أنظمتي.';
  }
}

client.once('ready', () => {
  console.log('Alfred Pennyworth is Online and at your service! 🕶️');
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  const cleanContent = message.content.trim();

  // ================= 1. نظام التحذير الإداري والاختصار المخصص =================
  if (cleanContent.startsWith('الفريد تحذير')) {
    
    // حماية الأمر: التحقق من أن منفذ الأمر لديه صلاحية طرد الأعضاء (إدمن أو مود)
    if (!message.member.permissions.has('KickMembers')) {
      return message.reply("عذراً سيدي، لا تملك الصلاحيات الإدارية الكافية لإصدار التحذيرات.");
    }

    // تحديد العضو المستهدف عبر المنشن
    const member = message.mentions.members.first();
    if (!member) {
      return message.reply("سيدي، يرجى تحديد العضو بعمل منشن له (مثال: الفريد تحذير @أحمد السبب).");
    }

    // استخراج السبب بدقة بتخطي "الفريد" و"تحذير" والمنشن
    const splitMessage = cleanContent.split(' ');
    const reasonArgs = splitMessage.slice(3); 
    const reason = reasonArgs.join(' ') || "لم يتم تحديد سبب رسمي من قبل الإدارة.";

    // رد ألفريد الرسمي والحازم في الشات
    return message.channel.send(
      `⚠️ **إشعار انضباطي من الخادم:**\n` +
      `سيدي ${member}، يرجى الالتزام بالقوانين العامة.\n` +
      `تم تسجيل تحذير رسمي بحقك بواسطة الإدارة (<@${message.author.id}>).\n` +
      `**السبب:** ${reason}`
    );
  }

  // ================= 2. نظام السوالف والرد بالذكاء الاصطناعي =================
  const isMentioned = message.mentions.has(client.user);
  let isReplyToAlfred = false;

  // التحقق مما إذا كان العضو يرد على رسالة سابقة لألفريد
  if (message.reference && message.reference.messageId) {
    try {
      const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
      if (repliedMsg.author.id === client.user.id) isReplyToAlfred = true;
    } catch (e) {}
  }

  // إذا لم يتم عمل منشن له أو الرد عليه، يتجاهل الشات
  if (!isMentioned && !isReplyToAlfred) return;

  // تنظيف الرسالة من منشن البوت قبل إرسالها للذكاء الاصطناعي
  let userMessage = cleanContent.replace(`<@${client.user.id}>`, '').trim();

  // تحويل أي منشن لعضو آخر إلى صيغة نصية يفهمها الذكاء الاصطناعي بدون تخريب
  const otherMention = message.mentions.users.find(u => u.id !== client.user.id);
  if (otherMention) {
    const mentionRegex = new RegExp(`<@!?${otherMention.id}>`, 'g');
    userMessage = userMessage.replace(mentionRegex, `[الشخص: ${otherMention.username}]`).trim();
  }

  // إذا كانت الرسالة فارغة (منشن فقط)
  if (!userMessage) {
    const defaultResponse = message.author.id === OWNER_ID 
      ? 'أنا في الخدمة دائماً يا سيدي بروس، كيف يمكنني مساعدتك الليلة؟' 
      : 'مرحباً بك يا سيدي، كيف يمكن لألفريد مساعدتك اليوم؟';
    return message.reply(defaultResponse);
  }

  // بدء الكتابة لإظهار تفاعل البوت الطبيعي
  await message.channel.sendTyping();

  // محاكاة تأخير بشري بسيط بين ثانيتين و3 ثوانٍ قبل إرسال الرد
  const randomDelay = Math.floor(Math.random() * (3000 - 2000) + 2000);

  setTimeout(async () => {
    const reply = await getAlfredReply(message.channel.id, message.author.username, userMessage);
    message.reply(reply);
  }, randomDelay);
});

// تشغيل البوت باستخدام توكن الديسكورد الخاص به
client.login(process.env.ALFRED_TOKEN);