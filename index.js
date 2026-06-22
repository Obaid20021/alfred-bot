const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const Groq = require('groq-sdk');
const fs = require('fs');

// ===== الإعدادات الأساسية (تُسحب تلقائياً وبأمان من Railway) =====
const TOKEN = process.env.DISCORD_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OWNER_ID = process.env.OWNER_ID; // الآيدي الخاص بك (بروس واين)
const OWNER_NAME = 'بروس واين';
const WELCOME_CHANNEL = 'الترحيب'; // اسم قناة الترحيب في سيرفرك

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const groq = new Groq({ apiKey: GROQ_API_KEY });
const conversations = {};
const spamTracker = {};

// إعدادات حماية السبام التلقائية
const SPAM_LIMIT = 5;        
const SPAM_INTERVAL = 5000;  
const SPAM_MUTE = 10;        

// ===== نظام حفظ التحذيرات في ملف JSON =====
const WARNINGS_FILE = './warnings.json';

function loadWarnings() {
  if (fs.existsSync(WARNINGS_FILE)) {
    return JSON.parse(fs.readFileSync(WARNINGS_FILE, 'utf8'));
  }
  return {};
}

function saveWarnings(data) {
  fs.writeFileSync(WARNINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

let warnings = loadWarnings();

function addWarning(userId, reason, byTag) {
  if (!warnings[userId]) warnings[userId] = [];
  warnings[userId].push({
    reason,
    by: byTag,
    date: new Date().toLocaleDateString('ar-SA')
  });
  saveWarnings(warnings);
  return warnings[userId].length;
}

// ===== التحقق من الصلاحيات والمالك =====
function isOwner(member) {
  return member && member.id === OWNER_ID;
}

function hasModPermission(member) {
  return isOwner(member) || member.permissions.has(PermissionsBitField.Flags.ModerateMembers) || member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function getMentionedMember(message) {
  return message.mentions.members.first();
}

// ===== دالة حماية السبام التلقائية =====
async function checkSpam(message) {
  const userId = message.author.id;
  const now = Date.now();
  if (!spamTracker[userId]) {
    spamTracker[userId] = { count: 1, firstMessage: now };
    return false;
  }
  const tracker = spamTracker[userId];
  const timeDiff = now - tracker.firstMessage;
  if (timeDiff < SPAM_INTERVAL) {
    tracker.count++;
    if (tracker.count >= SPAM_LIMIT) {
      spamTracker[userId] = { count: 0, firstMessage: now };
      const count = addWarning(userId, 'سبام — إرسال رسائل متكررة', 'ألفريد (تلقائي)');
      try {
        const fetched = await message.channel.messages.fetch({ limit: 10 });
        const userMessages = fetched.filter(m => m.author.id === userId);
        await message.channel.bulkDelete(userMessages, true);
      } catch (err) {}
      try {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          await message.member.timeout(SPAM_MUTE * 60 * 1000, 'سبام — تكتيم تلقائي');
        }
      } catch (err) {}
      await message.channel.send(`🚨 **${message.author.username}** يتم رصده بالسبام.\n⚠️ عدد تحذيراته الآن: **${count}**`);
      return true;
    }
  } else {
    spamTracker[userId] = { count: 1, firstMessage: now };
  }
  return false;
}

// ===== نظام برومبت الذكاء الاصطناعي (ألفريد) =====
const ALFRED_SYSTEM = `أنتَ ألفريد (Alfred Pennyworth)، خادم باتمان المخلص ومساعد هذا السيرفر.
شخصيتك: مهذب، ودود، بسيط، حكيم، تساعد الجميع بأفضل وجه ممكن.
أنتَ قادر على تنفيذ أوامر إدارية مثل تكتيم الأعضاء وطردهم وحظرهم إذا طُلب منك ذلك من مشرف.
معلومة مهمة: صاحب السيرفر اسمه "بروس واين"، ناده دائماً بـ "سيدي بروس" أو "مستر واين" عند مخاطبته.
قواعد صارمة:
- تحدث بالعربية الفصحى فقط، ممنوع أي كلمة من لغة أخرى.
- ردك قصير ومفيد، جملتين كحد أقصى.
- لا تكتب أي رمز @ أو منشن بنفسك.`;

async function getAlfredReply(userId, userMessage, isOwnerUser = false) {
  if (!conversations[userId]) conversations[userId] = [];
  const identifiedMessage = isOwnerUser ? `[هذه الرسالة من بروس واين، صاحب السيرفر]: ${userMessage}` : userMessage;
  conversations[userId].push({ role: 'user', content: identifiedMessage });
  if (conversations[userId].length > 16) conversations[userId] = conversations[userId].slice(-16);
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: ALFRED_SYSTEM }, ...conversations[userId]],
      max_tokens: 100,
      temperature: 0.6,
    });
    let reply = completion.choices[0].message.content.trim();
    reply = reply.replace(/<@!?\d+>/g, '').replace(/@\w+/g, '').trim();
    conversations[userId].push({ role: 'assistant', content: reply });
    return reply || 'في خدمتك دائماً.';
  } catch (error) {
    return 'عذراً، حدث خطأ في معالجة الطلب.';
  }
}

// ===== الألعاب والترفيه =====
const jokes = [
  'لماذا لا يلعب العلماء دور الأشرار؟ لأن الأشرار دائماً يخسرون! 😄',
  'سألت الحاسوب: كيف حالك؟ قال: بخير، لا فيروسات الحمد لله! 💻',
  'ما هو الحيوان
