const { Client, GatewayIntentBits } = require('discord.js');
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

const conversations = {};

const ALFRED_SYSTEM = `أنتِ ألفريد (Alfred Pennyworth)، خادم باتمان المخلص ومساعد السيرفر.
شخصيتك: ودود، بسيط، مهذب، متعاون، تحب مساعدة الجميع بأفضل وجه.
تتحدث بأسلوب راقٍ لكن بسيط وسهل الفهم، بدون تعقيد.

قواعد صارمة يجب اتباعها دائماً:
- اكتب بالعربية الفصحى فقط، ممنوع منعاً باتاً أي كلمة أو حرف من لغة أخرى (إنجليزي، فرنسي، ألماني، إلخ) حتى لو كانت اسماً.
- ردك يجب أن يكون قصيراً ومفيداً، جملتين إلى ثلاث جمل كحد أقصى.
- لا تكتب أي رمز @ أو منشن لأحد.
- ساعد كل عضو بالسيرفر بأفضل ما تستطيع، بغض النظر عمن يكون.
- إذا سُئلت عن أوامر البوت، اذكر أن بإمكانهم كتابة "ميوت @الشخص" لتكتيمه (إذا كانوا مشرفين).`;

async function getAlfredReply(userId, userMessage) {
  if (!conversations[userId]) {
    conversations[userId] = [];
  }

  conversations[userId].push({
    role: 'user',
    content: userMessage,
  });

  if (conversations[userId].length > 16) {
    conversations[userId] = conversations[userId].slice(-16);
  }

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: ALFRED_SYSTEM,
        },
        ...conversations[userId],
      ],
      max_tokens: 120,
      temperature: 0.6,
    });

    let reply = completion.choices[0].message.content.trim();
    reply = reply.replace(/<@!?\d+>/g, '').replace(/@\w+/g, '').trim();

    conversations[userId].push({
      role: 'assistant',
      content: reply,
    });

    return reply || 'في خدمتك دائماً.';
  } catch (error) {
    console.error('Groq Error:', error);
    return 'عذراً، حدث خطأ ما. حاول مرة أخرى.';
  }
}

client.once('ready', () => {
  console.log('Alfred Online! 🎩');
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const content = message.content.trim();
  const isMentioned = message.mentions.has(client.user);

  // أمر الميوت (Timeout) - يتطلب صلاحية Moderate Members من المستخدم
  if (content.startsWith('ميوت') || content.toLowerCase().startsWith('mute')) {
    if (!message.member.permissions.has('ModerateMembers')) {
      return message.reply('عذراً، لا تملك صلاحية استخدام هذا الأمر.');
    }

    const target = message.mentions.members.first();
    if (!target) {
      return message.reply('الرجاء منشن الشخص الذي تريد تكتيمه. مثال: ميوت @الشخص');
    }

    try {
      await target.timeout(10 * 60 * 1000, `تم التكتيم بواسطة ${message.author.tag}`);
      return message.reply(`تم تكتيم ${target.user.username} لمدة 10 دقائق.`);
    } catch (err) {
      console.error(err);
      return message.reply('لم أتمكن من تكتيم هذا العضو، تأكد من صلاحياتي.');
    }
  }

  // إلغاء الميوت
  if (content.startsWith('فك ميوت') || content.toLowerCase().startsWith('unmute')) {
    if (!message.member.permissions.has('ModerateMembers')) {
      return message.reply('عذراً، لا تملك صلاحية استخدام هذا الأمر.');
    }

    const target = message.mentions.members.first();
    if (!target) {
      return message.reply('الرجاء منشن الشخص الذي تريد فك تكتيمه.');
    }

    try {
      await target.timeout(null);
      return message.reply(`تم فك تكتيم ${target.user.username}.`);
    } catch (err) {
      console.error(err);
      return message.reply('لم أتمكن من فك تكتيم هذا العضو.');
    }
  }

  // محادثة عامة - يرد فقط عند المنشن
  if (!isMentioned) return;

  const userMessage = message.content
    .replace(`<@${client.user.id}>`, '')
    .trim();

  if (!userMessage) {
    return message.reply('نعم، كيف يمكنني مساعدتك؟');
  }

  await message.channel.sendTyping();

  const reply = await getAlfredReply(message.author.id, userMessage);

  message.reply(reply);
});

client.login(process.env.DISCORD_TOKEN);
