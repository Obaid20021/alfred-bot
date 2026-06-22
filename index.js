const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const Groq = require('groq-sdk');
const fs = require('fs');

// ===== الإعدادات الأساسية =====
const TOKEN = 'ضع_توكن_البوت_هنا';
const GROQ_API_KEY = 'ضع_مفتاح_جروق_هنا';
const OWNER_ID = 'ضع_الآيدي_الخاص_بك_هنا'; // الآيدي الخاص بك (بروس واين)
const OWNER_NAME = 'بروس واين';
const WELCOME_CHANNEL = 'الترحيب'; // اسم قناة الترحيب

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

// إعدادات حماية السبام
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
  return member.id === OWNER_ID;
}

function hasModPermission(member) {
  return isOwner(member) || member.permissions.has(PermissionsBitField.Flags.ModerateMembers);
}

function hasKickPermission(member) {
  return isOwner(member) || member.permissions.has(PermissionsBitField.Flags.KickMembers);
}

function hasBanPermission(member) {
  return isOwner(member) || member.permissions.has(PermissionsBitField.Flags.BanMembers);
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
      } catch {}
      try {
        await message.member.timeout(SPAM_MUTE * 60 * 1000, 'سبام — تكتيم تلقائي');
      } catch {}
      await message.channel.send(`🚨 **${message.author.username}** يتم تكتيمه لمدة **${SPAM_MUTE} دقائق** بسبب السبام.\n⚠️ عدد تحذيراته الآن: **${count}**`);
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

// ===== الترفيه المسبق =====
const jokes = [
  'لماذا لا يلعب العلماء دور الأشرار؟ لأن الأشرار دائماً يخسرون! 😄',
  'سألت الحاسوب: كيف حالك؟ قال: بخير، لا فيروسات الحمد لله! 💻',
  'ما هو الحيوان الذي يسكن في الهاتف؟ الرامات! 🐏',
  'لماذا البرمجة مثل الحب؟ خطأ صغير يدمر كل شيء! ❤️'
];
const quotes = [
  'النجاح ليس نهاية الطريق، والفشل ليس نهاية العالم. — تشرشل',
  'لا تنتظر الفرصة، بل اصنعها. — جورج برنارد شو',
  'العقل الكبير يناقش الأفكار، والعقل الصغير يناقش الناس.'
];
const triviaQuestions = [
  { q: 'ما عاصمة فرنسا؟', a: 'باريس' },
  { q: 'كم عدد أيام السنة؟', a: '365' },
  { q: 'ما أكبر كوكب في المجموعة الشمسية؟', a: 'المشتري' }
];

// ===== الأحداث (Events) =====
client.once('ready', () => {
  console.log(`✅ تم تشغيل البوت بنجاح باسم: ${client.user.tag}`);
});

// حدث الترحيب بالأعضاء
client.on('guildMemberAdd', async member => {
  const channel = member.guild.channels.cache.find(ch => ch.name === WELCOME_CHANNEL);
  if (!channel) return;
  if (member.id === OWNER_ID) {
    await channel.send(`🦇 أهلاً بعودتك، **سيدي بروس واين**.\nكنا ننتظرك. السيرفر في خدمتك كما دائماً.`);
  } else {
    await channel.send(`👋 أهلاً وسهلاً بـ **${member.user.username}** في السيرفر!\nنتمنى لك وقتاً ممتعاً بيننا. 🎩`);
  }
});

// حدث الرسائل
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  // فحص السبام لغير المالك
  if (message.author.id !== OWNER_ID) {
    const isSpam = await checkSpam(message);
    if (isSpam) return;
  }

  const cleanContent = message.content.trim();

  // 1. ===== أوامر بروس واين الخاصة (المالك فقط) =====
  if (isOwner(message.member)) {
    if (cleanContent.startsWith('أعلن')) {
      const text = cleanContent.replace(/^أعلن/i, '').trim();
      if (!text) return message.reply('اكتب نص الإعلان.');
      await message.delete().catch(() => {});
      return message.channel.send(`📢 **إعلان رسمي من إدارة السيرفر:**\n\n${text}`);
    }
    if (cleanContent.startsWith('راسل')) {
      const target = getMentionedMember(message);
      if (!target) return message.reply('حدد العضو بالمنشن.');
      const text = cleanContent.replace(/^راسل/i, '').replace(/<@!?\d+>/, '').trim();
      if (!text) return message.reply('اكتب الرسالة.');
      try {
        await target.send(`📩 رسالة من إدارة السيرفر:\n\n${text}`);
        await message.delete().catch(() => {});
        return message.channel.send(`✅ تم إرسال الرسالة لـ **${target.user.username}**.`);
      } catch { return message.reply('فشل الإرسال، الحساب مغلق الخاص.'); }
    }
    if (cleanContent === 'قفل') {
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
      return message.channel.send('🔒 تم قفل القناة.');
    }
    if (cleanContent === 'فتح') {
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
      return message.channel.send('🔓 تم فتح القناة.');
    }
    if (cleanContent === 'إحصائيات') {
      const totalWarnings = Object.values(warnings).reduce((a, b) => a + b.length, 0);
      return message.reply(`📊 **إحصائيات السيرفر:**\n👥 الأعضاء: **${message.guild.memberCount}**\n⚠️ إجمالي التحذيرات: **${totalWarnings}**`);
    }
    if (cleanContent === 'اغلق') {
      await message.reply('🎩 هل أنت متأكد من إغلافي سيدي بروس؟ اكتب **تأكيد** خلال 10 ثواني.');
      const filter = m => m.author.id === OWNER_ID;
      try {
        const collected = await message.channel.awaitMessages({ filter, max: 1, time: 10000, errors: ['time'] });
        if (collected.first().content === 'تأكيد') {
          await message.channel.send('🎩 في أمان الله سيدي بروس. يتم الإغلاق الآن...');
          process.exit(0);
        }
      } catch { return message.reply('تم إلغاء الإغلاق لعدم التأكيد.'); }
    }
  }

  // 2. ===== الأوامر الإدارية (تطلب السبب) =====
  if (cleanContent.startsWith('ميوت')) {
    if (!hasModPermission(message.member)) return message.reply('لا تملك الصلاحية.');
    const target = getMentionedMember(message);
    if (!target) return message.reply('الرجاء منشن العضو.');
    const minutesMatch = cleanContent.match(/(\d+)/);
    let duration = 10 * 60 * 1000; // افتراضي 10 دقائق
    if (minutesMatch) duration = parseInt(minutesMatch[1]) * 60 * 1000;

    await message.reply(`ما سبب تكتيم ${target.user.username}؟ (لديك 30 ثانية)`);
    const filter = m => m.author.id === message.author.id;
    let reason = 'لم يُذكر سبب';
    try {
      const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
      reason = collected.first().content;
    } catch { return message.channel.send('انتهى الوقت، تم الإلغاء.'); }

    try {
      await target.timeout(duration, `${reason} | بواسطة ${message.author.tag}`);
      return message.reply(`✅ تم تكتيم **${target.user.username}**.\n📋 **السبب:** ${reason}`);
    } catch { return message.reply('فشلت العملية، تأكد من صلاحياتي.'); }
  }

  if (cleanContent.startsWith('تحذير')) {
    if (!hasModPermission(message.member)) return message.reply('لا تملك الصلاحية.');
    const target = getMentionedMember(message);
    if (!target) return message.reply('الرجاء منشن العضو.');

    await message.reply(`ما سبب تحذير ${target.user.username}؟ (لديك 30 ثانية)`);
    const filter = m => m.author.id === message.author.id;
    let reason = 'لم يُذكر سبب';
    try {
      const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
      reason = collected.first().content;
    } catch { return message.channel.send('انتهى الوقت، تم الإلغاء.'); }

    const count = addWarning(target.id, reason, message.author.tag);
    await message.reply(`⚠️ تم تحذير **${target.user.username}**.\n📋 **السبب:** ${reason}\n🔢 **التحذيرات الحالية:** ${count}`);

    if (count >= 3) {
      try {
        await target.timeout(60 * 60 * 1000, 'الوصول لـ 3 تحذيرات');
        await message.channel.send(`🔇 تم تكتيم **${target.user.username}** تلقائياً لمدة ساعة لوصوله لـ 3 تحذيرات.`);
      } catch {}
    }
  }

  if (cleanContent.startsWith('سجل')) {
    const target = getMentionedMember(message);
    if (!target) return message.reply('الرجاء منشن العضو.');
    const userWarnings = warnings[target.id];
    if (!userWarnings || userWarnings.length === 0) return message.reply('السجل نظيف.');
    const list = userWarnings.map((w, i) => `**${i + 1}.** ${w.reason} — بواسطة ${w.by} (${w.date})`).join('\n');
    return message.reply(`📋 **سجل تحذيرات ${target.user.username}:**\n${list}`);
  }

  if (cleanContent.startsWith('مسح تحذيرات')) {
    if (!hasModPermission(message.member)) return message.reply('لا تملك الصلاحية.');
    const target = getMentionedMember(message);
    if (!target) return message.reply('الرجاء منشن العضو.');
    warnings[target.id] = [];
    saveWarnings(warnings);
    return message.reply(`🗑️ تم مسح تحذيرات **${target.user.username}**.`);
  }

  // 3. ===== تفاعل وترفيه =====
  if (cleanContent === 'نكتة') {
    return message.reply(`😄 ${jokes[Math.floor(Math.random() * jokes.length)]}`);
  }
  if (cleanContent === 'اقتباس') {
    return message.reply(`✨ *${quotes[Math.floor(Math.random() * quotes.length)]}*`);
  }
  if (cleanContent === 'نرد') {
    return message.reply(`🎲 الناتج: **${Math.floor(Math.random() * 6) + 1}**`);
  }
  if (cleanContent.startsWith('روليت')) {
    const target = getMentionedMember(message);
    if (!target) return message.reply('منشن الشخص المنافس.');
    const winner = Math.random() < 0.5 ? message.member.user.username : target.user.username;
    return message.reply(`🎰 جولة روليت بينك وبين ${target}...\n🏆 الفائز هو: **${winner}**!`);
  }
  if (cleanContent === 'تريفيا') {
    const q = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
    await message.reply(`🧠 **سؤال:** ${q.q}\n لديك 20 ثانية للإجابة!`);
    const filter = m => m.author.id === message.author.id;
    try {
      const collected = await message.channel.awaitMessages({ filter, max: 1, time: 20000, errors: ['time'] });
      if (collected.first().content.trim() === q.a) {
        return message.channel.send(`✅ إجابة صحيحة يا **${message.author.username}**! 🎉`);
      } else {
        return message.channel.send(`❌ خاطئة! الإجابة الصحيحة: **${q.a}**`);
      }
    } catch { return message.channel.send(`⏰ انتهى الوقت! الإجابة: **${q.a}**`); }
  }

  // 4. ===== ذكاء اصطناعي (أوامر مباشرة بدون منشن) =====
  if (cleanContent.startsWith('لخص')) {
    const numMatch = cleanContent.match(/\d+/);
    const amount = numMatch ? Math.min(parseInt(numMatch[0]), 50) : 20;
    await message.channel.sendTyping();
    const messages = await message.channel.messages.fetch({ limit: amount });
    const chatLog = messages.reverse().filter(m => !m.author.bot).map(m => `${m.author.username}: ${m.content}`).join('\n');
    if (!chatLog) return message.reply('لا توجد رسائل لتلخيصها.');
    try {
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: 'لخّص هذه المحادثة بالعربية الفصحى في 3 جمل كحد أقصى مبيناً أهم الأفكار.' }, { role: 'user', content: chatLog }],
      });
      return message.reply(`📋 **ملخص آخر ${amount} رسالة:**\n${completion.choices[0].message.content.trim()}`);
    } catch { return message.reply('فشل التلخيص.'); }
  }

  if (cleanContent.startsWith('ترجم')) {
    const text = cleanContent.replace(/^ترجم/i, '').trim();
    if (!text) return message.reply('اكتب النص للترجمة.');
    await message.channel.sendTyping();
    try {
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: 'ترجم النص المعطى إلى العربية إذا كان بلغة أخرى، أو إلى الإنجليزية إذا كان عربياً، مباشرة وبدون مقدمات.' }, { role: 'user', content: text }],
      });
      return message.reply(`🌐 **الترجمة:**\n${completion.choices[0].message.content.trim()}`);
    } catch { return message.reply('فشلت الترجمة.'); }
  }

  if (cleanContent.startsWith('اسأل')) {
    const question = cleanContent.replace(/^اسأل/i, '').trim();
    if (!question) return message.reply('ما هو سؤالك؟');
    await message.channel.sendTyping();
    try {
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: 'أنت ألفريد، أجب على هذا السؤال بذكاء واختصار مفيد جداً باللغة العربية الفصحى.' }, { role: 'user', content: question }],
      });
      return message.reply(`🤖 ${completion.choices[0].message.content.trim()}`);
    } catch { return message.reply('عذراً، لم أستطع الإجابة حالياً.'); }
  }

  // 5. ===== المحادثة الحرة عند المنشن مع ألفريد =====
  const isMentioned = message.mentions.has(client.user) && !message.mentions.everyone;
  if (!isMentioned) return;

  if (!cleanContent.replace(/<@!?\d+>/g, '').trim()) {
    const greeting = isOwner(message.member) ? 'نعم، سيدي بروس؟ كيف يمكنني خدمتك اليوم؟' : 'نعم، كيف يمكنني مساعدتك؟';
    return message.reply(greeting);
  }

  await message.channel.sendTyping();
  const filteredContent = cleanContent.replace(/<@!?\d+>/g, '').trim();
  const reply = await getAlfredReply(message.author.id, filteredContent, isOwner(message.member));
  message.reply(reply);
});

client.login(TOKEN);
