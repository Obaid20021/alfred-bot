const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const Groq = require('groq-sdk');
const fs = require('fs');

// ===== الإعدادات الأساسية =====
const TOKEN = process.env.DISCORD_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OWNER_ID = process.env.OWNER_ID; 
const OWNER_NAME = "بروس واين";
const WELCOME_CHANNEL = "الترحيب"; 

// ===== قائمة الكلمات المحظورة =====
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

let activeCategoryGame = null;
let activeWordChain = null;
let activeSpeedGame = null;

// ===== نظام حفظ التحذيرات =====
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

// ===== نظام برومبت ألفريد المطور لمعرفة الميوت والتحذيرات =====
const ALFRED_SYSTEM = `أنتَ ألفريد (Alfred Pennyworth)، خادم بروس واين الحكيم والمخلص.
شخصيتك: هادئ، ذكي، لبق، ومختصر جداً وبأقل الكلمات الممكنة.
صاحب السيرفر والمسؤول عنك هو "بروس واين"، ناده دائماً بـ "سيدي بروس".

قواعد صارمة للردود:
- تحدث بالعربية الفصحى المبسطة والطبيعية تماماً.
- ممنوع التكرار، وممنوع نهائياً المقدمات الطويلة.
- ردك يجب أن يكون قصيراً ومباشراً جداً (جملة واحدة أو بضع كلمات).
- إذا سألك سيدي بروس عن المكتومين (ميوت/كتم) أو المحذرين، اعتمد بالكامل على البيانات الحقيقية والواقعية المرفقة لك في الأسفل ولا تؤلف؛ واستخدم صيغة المنشن المتاحة للأعضاء المحذرين أو المكتومين ليظهر المنشن أزرق وتفاعلياً.`;

async function getAlfredReply(userId, userMessage, isOwnerUser = false, channel = null) {
  if (!conversations[userId]) conversations[userId] = [];
  
  // 1. جلب بيانات التحذيرات
  const currentWarnings = loadWarnings();
  let warningsSummary = "لا يوجد أي أعضاء محذرين حالياً.\n";
  if (Object.keys(currentWarnings).length > 0 && channel) {
    warningsSummary = "بيانات التحذيرات الحالية:\n";
    for (const [id, warns] of Object.entries(currentWarnings)) {
      const member = channel.guild.members.cache.get(id);
      const name = member ? member.user.username : `عضو غير معروف`;
      warningsSummary += `- العضو (${name}) منشنه: <@${id}> لديه ${warns.length} تحذير(ات) بسبب: ${warns[warns.length - 1].reason}\n`;
    }
  }

  // 2. جلب الأعضاء المكتومين (ميوت) حياً من صلاحيات القناة
  let mutedSummary = "لا يوجد أي أعضاء مكتومين (ميوت) في هذه القناة حالياً.";
  if (channel) {
    const mutedMembers = [];
    channel.permissionOverwrites.cache.forEach((overwrite) => {
      // التأكد من أن التعديل موجه لعضو محدد (وليس رتبة) وأنه ممنوع من إرسال الرسائل
      if (overwrite.type === 1) { 
        const isMuted = overwrite.deny.has(PermissionsBitField.Flags.SendMessages);
        if (isMuted) {
          const member = channel.guild.members.cache.get(overwrite.id);
          const name = member ? member.user.username : `عضو مكتوم`;
          mutedMembers.push({ id: overwrite.id, name });
        }
      }
    });

    if (mutedMembers.length > 0) {
      mutedSummary = "الأعضاء المكتومين (ميوت/كتم) حالياً في هذه القناة هم:\n";
      mutedMembers.forEach(m => {
        mutedSummary += `- العضو (${m.name}) وصيغة منشنه هي: <@${m.id}>\n`;
      });
    }
  }

  const systemContext = `${ALFRED_SYSTEM}\n\n[البيانات الواقعية للحالة الحالية في السيرفر]:\n${warningsSummary}\n${mutedSummary}`;

  const identifiedMessage = isOwnerUser ? `[رسالة من سيدي بروس واين]: ${userMessage}` : userMessage;
  conversations[userId].push({ role: 'user', content: identifiedMessage });
  
  if (conversations[userId].length > 10) conversations[userId] = conversations[userId].slice(-10);
  
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: systemContext }, ...conversations[userId]],
      max_tokens: 80, 
      temperature: 0.3,
    });
    let reply = completion.choices[0].message.content.trim();
    conversations[userId].push({ role: 'assistant', content: reply });
    return reply;
  } catch (error) { return "عذراً سيدي، واجهت مشكلة في قراءة البيانات الحالية."; }
}

// ===== داتا الألعاب =====
const alphabet = ["أ", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر", "ز", "س", "ش", "ص", "ض", "ط", "ظ", "ع", "غ", "ف", "ق", "ك", "ل", "م", "ن", "هـ", "و", "ي"];
const categories = ["دولة", "جماد", "حيوان", "نبات / فاكهة", "أكلة / طبخة", "مهنة / وظيفة"];

const cutTweets = [
  "ما هي العادة الغريبة التي تفعلها ولا يعلم عنها أحد؟ 🤔",
  "صف نفسك بكلمة واحدة فقط! ✨",
  "لو ربحت مليون دولار الآن، ما هو أول شيء ستشتريه؟ 💰"
];

const wouldYouRather = [
  { q: "تعيش وحيداً في جزيرة مع إنترنت سريع جداً 🏝️ أو تعيش مع أصدقائك بدون إنترنت نهائياً 👥؟", opt1: "🏝️", opt2: "👥" }
];

const speedWords = ["قسطنطينية", "أخطبوط", "إمبراطورية", "سيرفر ديسكورد", "ألفريد بينيورث", "بروس واين"];

client.once('ready', () => { console.log(`✅ تم تشغيل البوت بنجاح باسم: ${client.user.tag}`); });

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

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
            await message.channel.send(`🔇 تم كتم **${message.author.username}** تلقائياً لوصوله لـ 3 تحذيرات.`);
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

  // 2. ===== الأوامر الإدارية =====
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
    if (!target) return message.reply("📋 يرجى منشن العضو. مثال: `مسح تحذيرات @العضو` ");
    
    warnings = loadWarnings();
    if (warnings[target.id]) {
      delete warnings[target.id];
      saveWarnings(warnings);
      try { await message.channel.permissionOverwrites.delete(target).catch(() => {}); } catch(e) {}
      return message.reply(`✨ تم تصفير تحذيرات العضو **${target.user.username}** بنجاح.`);
    } else {
      return message.reply(`📝 العضو **${target.user.username}** ليس لديه تحذيرات.`);
    }
  }

  if (cleanContent.startsWith('سجل')) {
    const target = getMentionedMember(message) || message.member;
    warnings = loadWarnings();
    const userWarns = warnings[target.id];
    if (!userWarns || userWarns.length === 0) return message.reply(`📝 السجل نظيف للعضو **${target.user.username}**.`);
    let embed = `📋 **سجل تحذيرات (${target.user.username}):**\n`;
    userWarns.forEach((w, i) => { embed += `\n**[${i+1}]** التاريخ: ${w.date} | السبب: ${w.reason}`; });
    return message.channel.send(embed);
  }

  // 3. ===== قائمة الألعاب =====
  if (cleanContent === 'خمن') {
    if (activeCategoryGame || activeSpeedGame) return message.reply("هناك لعبة جارية حالياً!");
    const randomLetter = alphabet[Math.floor(Math.random() * alphabet.length)];
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];
    activeCategoryGame = { letter: randomLetter, category: randomCategory, channelId: message.channel.id };
    await message.channel.send(`🎮 **تحدي الحروف:** أسرع شخص يكتب **${randomCategory}** يبدأ بحرف **( ${randomLetter} )**!`);
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
          await m.reply(`🏆 الفائز: **${m.author.username}** بالإجابة: (${answer})!`);
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
  if (!filteredContent) return message.reply(isOwner(message.member) ? "نعم سيدي بروس؟" : "كيف يمكنني مساعدتك؟");

  await message.channel.sendTyping();
  // تمرير جافا سكريبت الـ channel بالكامل ليفحص الأذونات المكتومة مباشرة
  const reply = await getAlfredReply(message.author.id, filteredContent, isOwner(message.member), message.channel);
  message.reply(reply);
});

client.login(TOKEN);