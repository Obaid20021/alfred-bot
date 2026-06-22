const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const Groq = require('groq-sdk');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ]
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const OWNER_ID = '648818494808391696';

const conversations = {};

const ALFRED_SYSTEM = `أنتَ ألفريد (Alfred Pennyworth)، خادم باتمان المخلص ومساعد هذا السيرفر.
شخصيتك: مهذب، ودود، بسيط، حكيم، تساعد الجميع بأفضل وجه ممكن.
أنتَ قادر على تنفيذ أوامر إدارية مثل تكتيم الأعضاء وطردهم وحظرهم إذا طُلب منك ذلك من مشرف.

قواعد صارمة:
- تحدث بالعربية الفصحى فقط، ممنوع أي كلمة من لغة أخرى.
- ردك قصير ومفيد، جملتين كحد أقصى.
- لا تكتب أي رمز @ أو منشن بنفسك.
- إذا طُلب منك تكتيم شخص أو طرده أو حظره، قل إنك ستنفذ الأمر (الكود سينفذه فعلاً).`;

async function getAlfredReply(userId, userMessage) {
  if (!conversations[userId]) {
    conversations[userId] = [];
  }

  conversations[userId].push({ role: 'user', content: userMessage });

  if (conversations[userId].length > 16) {
    conversations[userId] = conversations[userId].slice(-16);
  }

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: ALFRED_SYSTEM },
        ...conversations[userId],
      ],
      max_tokens: 100,
      temperature: 0.6,
    });

    let reply = completion.choices[0].message.content.trim();
    reply = reply.replace(/<@!?\d+>/g, '').replace(/@\w+/g, '').trim();

    conversations[userId].push({ role: 'assistant', content: reply });

    return reply || 'في خدمتك دائماً.';
  } catch (error) {
    console.error('Groq Error:', error);
    return 'عذراً، حدث خطأ ما. حاول مرة أخرى.';
  }
}

function isOwner(member) {
  return member.id === OWNER_ID;
}

function getMentionedMember(message) {
  return message.mentions.members.first();
}

function hasModPermission(member) {
  return isOwner(member) || member.permissions.has(PermissionsBitField.Flags.ModerateMembers);
}

function hasBanPermission(member) {
  return isOwner(member) || member.permissions.has(PermissionsBitField.Flags.BanMembers);
}

function hasKickPermission(member) {
  return isOwner(member) || member.permissions.has(PermissionsBitField.Flags.KickMembers);
}

client.once('ready', () => {
  console.log('Alfred Online! 🎩');
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const isMentioned = message.mentions.has(client.user);

  // نزيل منشن ألفريد من الرسالة
  const cleanContent = message.content
    .replace(`<@${client.user.id}>`, '')
    .trim();

  // ===== أوامر إدارية =====

  // ميوت
  if (cleanContent.startsWith('ميوت') || cleanContent.startsWith('mute')) {
    if (!hasModPermission(message.member)) {
      return message.reply('عذراً، لا تملك صلاحية التكتيم.');
    }
    const target = getMentionedMember(message);
    if (!target) return message.reply('الرجاء تحديد العضو بالمنشن. مثال: ميوت @الشخص');
    
    // استخراج المدة (افتراضي 10 دقائق)
    const minutesMatch = cleanContent.match(/(\d+)\s*(دقيقة|دقائق|ساعة|ساعات|يوم|أيام)?/);
    let duration = 10 * 60 * 1000; // 10 دقائق افتراضي
    if (minutesMatch) {
      const num = parseInt(minutesMatch[1]);
      if (cleanContent.includes('ساعة') || cleanContent.includes('ساعات')) {
        duration = num * 60 * 60 * 1000;
      } else if (cleanContent.includes('يوم') || cleanContent.includes('أيام')) {
        duration = num * 24 * 60 * 60 * 1000;
      } else {
        duration = num * 60 * 1000;
      }
    }

    try {
      await target.timeout(duration, `تم التكتيم بواسطة ${message.author.tag}`);
      return message.reply(`تم تكتيم ${target.user.username} لمدة ${Math.floor(duration/60000)} دقيقة.`);
    } catch {
      return message.reply('لم أتمكن من تكتيم هذا العضو، تأكد من صلاحياتي.');
    }
  }

  // فك ميوت
  if (cleanContent.startsWith('فك ميوت') || cleanContent.startsWith('unmute')) {
    if (!hasModPermission(message.member)) {
      return message.reply('عذراً، لا تملك صلاحية فك التكتيم.');
    }
    const target = getMentionedMember(message);
    if (!target) return message.reply('الرجاء تحديد العضو بالمنشن.');
    try {
      await target.timeout(null);
      return message.reply(`تم فك تكتيم ${target.user.username}.`);
    } catch {
      return message.reply('لم أتمكن من فك تكتيم هذا العضو.');
    }
  }

  // كيك (طرد)
  if (cleanContent.startsWith('كيك') || cleanContent.startsWith('طرد') || cleanContent.startsWith('kick')) {
    if (!hasKickPermission(message.member)) {
      return message.reply('عذراً، لا تملك صلاحية الطرد.');
    }
    const target = getMentionedMember(message);
    if (!target) return message.reply('الرجاء تحديد العضو بالمنشن.');
    try {
      await target.kick(`تم الطرد بواسطة ${message.author.tag}`);
      return message.reply(`تم طرد ${target.user.username} من السيرفر.`);
    } catch {
      return message.reply('لم أتمكن من طرد هذا العضو، تأكد من صلاحياتي.');
    }
  }

  // باند (حظر)
  if (cleanContent.startsWith('باند') || cleanContent.startsWith('حظر') || cleanContent.startsWith('ban')) {
    if (!hasBanPermission(message.member)) {
      return message.reply('عذراً، لا تملك صلاحية الحظر.');
    }
    const target = getMentionedMember(message);
    if (!target) return message.reply('الرجاء تحديد العضو بالمنشن.');
    try {
      await target.ban({ reason: `تم الحظر بواسطة ${message.author.tag}` });
      return message.reply(`تم حظر ${target.user.username} من السيرفر.`);
    } catch {
      return message.reply('لم أتمكن من حظر هذا العضو، تأكد من صلاحياتي.');
    }
  }

  // كلير (حذف رسائل)
  if (cleanContent.startsWith('كلير') || cleanContent.startsWith('clear')) {
    if (!isOwner(message.member) && !message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      return message.reply('عذراً، لا تملك صلاحية حذف الرسائل.');
    }
    const numMatch = cleanContent.match(/\d+/);
    const amount = numMatch ? Math.min(parseInt(numMatch[0]), 100) : 10;
    try {
      await message.channel.bulkDelete(amount, true);
      return message.channel.send(`تم حذف ${amount} رسالة.`).then(msg => {
        setTimeout(() => msg.delete().catch(() => {}), 3000);
      });
    } catch {
      return message.reply('لم أتمكن من حذف الرسائل.');
    }
  }

  // ===== محادثة عامة - يرد فقط عند المنشن =====
  if (!isMentioned) return;

  if (!cleanContent) {
    return message.reply('نعم، كيف يمكنني مساعدتك؟');
  }

  await message.channel.sendTyping();
  const reply = await getAlfredReply(message.author.id, cleanContent);
  message.reply(reply);
});

client.login(process.env.DISCORD_TOKEN);
