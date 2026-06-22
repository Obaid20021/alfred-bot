const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const Groq = require('groq-sdk');
const fs = require('fs');

// ===== الإعدادات الأساسية (تُسحب تلقائياً وبأمان من Railway) =====
const TOKEN = process.env.DISCORD_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OWNER_ID = process.env.OWNER_ID; // الآيدي الخاص بك (بروس واين)
const OWNER_NAME = "بروس واين";
const WELCOME_CHANNEL = "الترحيب"; // اسم قناة الترحيب في سيرفرك

// ===== قائمة الكلمات المحظورة (نظام الفلترة التلقائي لحماية السيرفر) =====
const BANNED_WORDS = [
  "كلب", "حمار", "غبي", "يا غبي", "تلحس", "منيك", "قحبة", "شرموط", "تفو", "يلعن", "كس", "امك", "اختك"
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ]
});

const groq = new Groq({ apiKey: GROQ_API_KEY });
const conversations = {};
const spamTracker = {};

const SPAM_LIMIT = 5;        
const SPAM_INTERVAL = 5000;  

// أقفال الألعاب الجماعية
let activeCategoryGame = null;
let activeWordChain = null;
let activeSpeedGame = null;

// ===== نظام حفظ التحذيرات في ملف JSON =====
const WARNINGS_FILE = "./warnings.json";

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

function isOwner(member) {
  return member && member.id === OWNER_ID;
}

function hasModPermission(member) {
  return isOwner(member) || member.permissions.has(PermissionsBitField.Flags.ModerateMembers) || member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function getMentionedMember(message) {
  return message.mentions.members.first();
}

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
      const count = addWarning(userId, "سبام — إرسال رسائل متكررة", "ألفريد (تلقائي)");
      try {
        const fetched = await message.channel.messages.fetch({ limit: 10 });
        const userMessages = fetched.filter(m => m.author.id === userId);
        await message.channel.bulkDelete(userMessages, true);
      } catch (err) {}
      try {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          await message.channel.permissionOverwrites.edit(message.member, { SendMessages: false });
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

const ALFRED_SYSTEM = `أنتَ ألفريد (Alfred Pennyworth)، خادم باتمان المخلص ومساعد هذا السيرفر.
شخصيتك: مهذب، ودود، بسيط، حكيم، تساعد الجميع بأفضل وجه ممكن.
معلومة مهمة: صاحب السيرفر اسمه "بروس واين"، ناده دائماً بـ "سيدي بروس" أو "مستر واين" عند مخاطبته.
قواعد صارمة: تحدث بالعربية الفصحى فقط، ردك قصير جداً ومفيد.`;

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
    return reply || "في خدمتك دائماً.";
  } catch (error) { return "عذراً، حدث خطأ في معالجة الطلب."; }
}

// ===== داتا الألعاب المشهورة =====
const alphabet = ["أ", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر", "ز", "س", "ش", "ص", "ض", "ط", "ظ", "ع", "غ", "ف", "ق", "ك", "ل", "م", "ن", "هـ", "و", "ي"];
const categories = ["دولة", "جماد", "حيوان", "نبات / فاكهة", "أكلة / طبخة", "مهنة / وظيفة"];

const cutTweets = [
  "ما هي العادة الغريبة التي تفعلها ولا يعلم عنها أحد؟ 🤔",
  "لو أتيحت لك فرصة حذف شخص واحد من السيرفر، من سيكون؟ 👀",
  "صف نفسك بكلمة واحدة فقط! ✨",
  "لو ربحت مليون دولار الآن، ما هو أول شيء ستشتريه؟ 💰"
];

const wouldYouRather = [
  { q: "تعيش وحيداً في جزيرة مع إنترنت سريع جداً 🏝️ أو تعيش مع أصدقائك بدون إنترنت نهائياً 👥؟", opt1: "🏝️", opt2: "👥" },
  { q: "تستطيع الطيران ولكن ببطء شديد 🦅 أو تستطيع الاختفاء ولكن لـ 5 ثوانٍ فقط 🥷؟", opt1: "🦅", opt2: "🥷" }
];

const speedWords = ["قسطنطينية", "أخطبوط", "إمبراطورية", "سيرفر ديسكورد", "ألفريد بينيورث", "بروس واين"];

client.once('ready', () => { console.log(`✅ تم تشغيل البوت بنجاح باسم: ${client.user.tag}`); });

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  // نظام الحماية الآلي من الكلمات والسبام
  if (message.author.id !== OWNER_ID) {
    const hasBadWord = BANNED_WORDS.some(word => message.content.toLowerCase().includes(word));
    if (hasBadWord) {
      try { await message.delete().catch(() => {}); } catch (err) {}
      const count = addWarning(message.author.id, "استخدام ألفاظ غير لائقة (تلقائي)", "نظام الحماية التلقائي");
      await message.channel.send(`⚠️ **${message.author.username}**، تم حذف رسالتك وتحذيرك بسبب استخدام ألفاظ محظورة.\n🔢 عدد تحذيراتك الآن: **${count}**`);
      if (count >= 3) {
        try {
          if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            await message.channel.permissionOverwrites.edit(message.member, { SendMessages: false });
            await message.channel.send(`🔇 تم كتم **${message.author.username}** تلقائياً وسحب صلاحية الكتابة لوصوله لـ 3 تحذيرات.`);
          }
        } catch (err) {}
      }
      return;
    }
    const isSpam = await checkSpam(message);
    if (isSpam) return;
  }

  const cleanContent = message.content.trim();

  // جولة حرب الكلمات المستمرة
  if (activeWordChain && message.channel.id === activeWordChain.channelId) {
    if (!cleanContent.startsWith('حرب') && !cleanContent.startsWith('ايقاف حرب')) {
      const lastChar = activeWordChain.lastWord.slice(-1).toLowerCase();
      const firstChar = cleanContent.charAt(0).toLowerCase();
      if (firstChar === lastChar) {
        if (activeWordChain.usedWords.includes(cleanContent)) {
          await message.reply("❌ هذه الكلمة تم استخدامها من قبل!");
        } else if (message.author.id === activeWordChain.lastUserId) {
          await message.reply("❌ لا يمكنك اللعب مرتين متتاليتين!");
        } else {
          activeWordChain.lastWord = cleanContent;
          activeWordChain.lastUserId = message.author.id;
          activeWordChain.usedWords.push(cleanContent);
          activeWordChain.scores[message.author.username] = (activeWordChain.scores[message.author.username] || 0) + 1;
          await message.react('✅');
        }
        return;
      }
    }
  }

  // 1. ===== أوامر بروس واين الخاصة =====
  if (isOwner(message.member)) {
    if (cleanContent.startsWith('أعلن')) {
      const text = cleanContent.replace(/^أعلن/i, '').trim();
      if (!text) return message.reply("اكتب نص الإعلان.");
      await message.delete().catch(() => {});
      return message.channel.send(`📢 **إعلان رسمي من إدارة السيرفر:**\n\n${text}`);
    }
    if (cleanContent === 'قفل') {
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
      return message.channel.send("🔒 تم قفل القناة.");
    }
    if (cleanContent === 'فتح') {
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
      return message.channel.send("🔓 تم فتح القناة.");
    }
  }

  // 2. ===== الأوامر الإدارية (تم إصلاح وإعادة مسح تحذيرات هنا) =====
  if (cleanContent.startsWith('ميوت')) {
    if (!hasModPermission(message.member)) return message.reply("لا تملك الصلاحية.");
    const target = getMentionedMember(message);
    if (!target) return message.reply("الرجاء منشن العضو.");
    try {
      await message.channel.permissionOverwrites.edit(target, { SendMessages: false });
      return message.reply(`✅ تم منع **${target.user.username}** من إرسال الرسائل.`);
    } catch (err) { return message.reply("تعذر تنفيذ العملية."); }
  }

  if (cleanContent.startsWith('فك')) {
    if (!hasModPermission(message.member)) return message.reply("لا تملك الصلاحية.");
    const target = getMentionedMember(message);
    if (!target) return message.reply("الرجاء منشن العضو لإلغاء الميوت.");
    try {
      await message.channel.permissionOverwrites.delete(target);
      return message.reply(`✅ تم فك التكتيم عن **${target.user.username}**.`);
    } catch (err) { return message.reply("فشلت عملية فك الميوت."); }
  }

  if (cleanContent.startsWith('مسح تحذيرات')) {
    if (!hasModPermission(message.member)) return message.reply("❌ عذراً، هذا الأمر مخصص لطاقم الإدارة فقط سيدي.");
    const target = getMentionedMember(message);
    if (!target) return message.reply("📋 يرجى منشن العضو الذي تريد تصفير سجل عقوباته. مثال: `مسح تحذيرات @العضو` ");
    
    warnings = loadWarnings();
    if (warnings[target.id]) {
      delete warnings[target.id]; // حذف السجل الرقمي بالكامل من الذاكرة والملف
      saveWarnings(warnings);
      
      // حركة ذكية: فك الميوت الآلي عنه فور تصفير تحذيراته لراحة الإدارة
      try { await message.channel.permissionOverwrites.delete(target).catch(() => {}); } catch(e) {}
      
      return message.reply(`✨ تم تصفير ومسح سجل التحذيرات بالكامل للعضو **${target.user.username}** بنجاح وإعادة عدّاده إلى صفر.`);
    } else {
      return message.reply(`📝 العضو **${target.user.username}** ليس لديه أي تحذيرات سابقة في السجل لكي يتم مسحها.`);
    }
  }

  if (cleanContent.startsWith('سجل')) {
    const target = getMentionedMember(message) || message.member;
    warnings = loadWarnings();
    const userWarns = warnings[target.id];
    if (!userWarns || userWarns.length === 0) return message.reply(`📝 السجل نظيف تماماً للعضو **${target.user.username}**.`);
    let embed = `📋 **سجل عقوبات وتحذيرات العضو (${target.user.username}):**\n`;
    userWarns.forEach((w, i) => { embed += `\n**[${i+1}]** التاريخ: ${w.date} | بواسطة: ${w.by}\n⚠️ السبب: ${w.reason}\n──────────────────`; });
    return message.channel.send(embed);
  }

  // 3. ===== قائمة الألعاب الجماعية =====
  if (cleanContent === 'خمن') {
    if (activeCategoryGame || activeSpeedGame) return message.reply("هناك لعبة جارية حالياً!");
    const randomLetter = alphabet[Math.floor(Math.random() * alphabet.length)];
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];
    activeCategoryGame = { letter: randomLetter, category: randomCategory, channelId: message.channel.id };
    await message.channel.send(`🎮 **تحدي الحروف:** أسرع شخص يكتب **${randomCategory}** يبدأ بحرف **( ${randomLetter} )**! *(30 ثانية)*`);
    const filter = m => !m.author.bot;
    const collector = message.channel.createMessageCollector({ filter, time: 30000 });
    collector.on('collect', async m => {
      const answer = m.content.trim();
      let firstChar = answer.charAt(0);
      let targetLetter = activeCategoryGame.letter === "أ" ? ["أ", "ا", "إ", "آ"] : [activeCategoryGame.letter];
      if (!targetLetter.includes(firstChar)) return;
      try {
        const checkPrompt = `هل الكلمة "${answer}" تعتبر فعلياً صنفاً صحيحاً لـ "${randomCategory}" وتبدأ بحرف "${randomLetter}"؟ أجب بـ "نعم" أو "لا" فقط.`;
        const completion = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: checkPrompt }], max_tokens: 5, temperature: 0.1
        });
        const result = completion.choices[0].message.content.trim();
        if (result.includes("نعم") && activeCategoryGame) {
          await m.reply(`🏆 الفائز بالنقطة: **${m.author.username}** بالإجابة: (${answer})!`);
          activeCategoryGame = null;
          collector.stop();
        }
      } catch (err) {}
    });
    collector.on('end', () => { if (activeCategoryGame) { message.channel.send("⏰ انتهى الوقت."); activeCategoryGame = null; } });
    return;
  }

  if (cleanContent === 'سرعة') {
    if (activeCategoryGame || activeSpeedGame) return message.reply("هناك لعبة نشطة حالياً!");
    const randomWord = speedWords[Math.floor(Math.random() * speedWords.length)];
    activeSpeedGame = { word: randomWord, channelId: message.channel.id };
    await message.channel.send(`⚡ **أسرع واحد:** اكتب الكلمة التالية:\n✏️ **\`${randomWord}\`**`);
    const filter = m => !m.author.bot && m.content.trim() === activeSpeedGame.word;
    const collector = message.channel.createMessageCollector({ filter, max: 1, time: 20000 });
    collector.on('collect', async m => {
      if (activeSpeedGame) { await m.reply(`⚡ **${m.author.username}** هو أسرع شخص كتبها! 🥇`); activeSpeedGame = null; }
    });
    collector.on('end', () => { if (activeSpeedGame) { message.channel.send("⏰ انتهى الوقت."); activeSpeedGame = null; } });
    return;
  }

  if (cleanContent === 'كت') {
    const randomTweet = cutTweets[Math.floor(Math.random() * cutTweets.length)];
    return message.channel.send(`💬 **كت تويت:**\n\n"${randomTweet}"`);
  }

  if (cleanContent === 'خيروك') {
    const option = wouldYouRather[Math.floor(Math.random() * wouldYouRather.length)];
    const pollMessage = await message.channel.send(`🤔 **لو خيروك؟:**\n\n${option.q}`);
    try { await pollMessage.react(option.opt1); await pollMessage.react(option.opt2); } catch (err) {}
    return;
  }

  if (cleanContent === 'حرب') {
    if (activeWordChain) return message.reply(`اللعبة قائمة! الكلمة الحالية: **${activeWordChain.lastWord}**.`);
    activeWordChain = { channelId: message.channel.id, lastWord: "تنين", lastUserId: null, usedWords: ["تنين"], scores: {} };
    return message.channel.send(`⚔️ **بدأت حرب الكلمات!**\n📝 الكلمة الأولى: **تنين** (ابدأ بحرف الـ **ن**).`);
  }

  if (cleanContent === 'ايقاف حرب') {
    if (!activeWordChain || activeWordChain.channelId !== message.channel.id) return message.reply("لا توجد حرب كلمات نشطة.");
    let scoreBoard = "📊 **نتائج الحرب:**\n";
    const players = Object.keys(activeWordChain.scores);
    if (players.length === 0) { scoreBoard += "لا يوجد نقاط مسجلة."; } else {
      players.sort((a,b) => activeWordChain.scores[b] - activeWordChain.scores[a]);
      players.forEach((p, idx) => { scoreBoard += `🏅 **#${idx+1}** ${p}: ${activeWordChain.scores[p]} نقطة\n`; });
    }
    activeWordChain = null;
    return message.channel.send(`🏁 تم إنهاء الحرب!\n\n${scoreBoard}`);
  }

  // 4. ===== المحادثة الحرة عند المنشن =====
  const isMentioned = message.mentions.has(client.user) && !message.mentions.everyone;
  if (!isMentioned) return;

  const filteredContent = cleanContent.replace(/<@!?\d+>/g, '').trim();
  if (!filteredContent) return message.reply(isOwner(message.member) ? "نعم، سيدي بروس؟" : "نعم، كيف أساعدك؟");

  await message.channel.sendTyping();
  const reply = await getAlfredReply(message.author.id, filteredContent, isOwner(message.member));
  message.reply(reply);
});

client.login(TOKEN);
