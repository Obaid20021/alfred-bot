const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const Groq = require('groq-sdk');
const fs = require('fs');

// ===== إعداد العميل =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ]
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ===== المعرفات الثابتة =====
const BRUCE_ID    = '648818494808391696';
const MOHAMMED_ID = '839706219870814218';
const JOKER_ID    = '1052545362533023754';
const CATWOMAN_ID = '112233445566778899';

// ===== التحذيرات وحفظ البيانات =====
const WARNINGS_FILE = './warnings.json';

function loadWarnings() {
  if (fs.existsSync(WARNINGS_FILE)) {
    try { return JSON.parse(fs.readFileSync(WARNINGS_FILE, 'utf8')); }
    catch { return {}; }
  }
  return {};
}

function saveWarnings(data) {
  fs.writeFileSync(WARNINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

let warnData = loadWarnings();

function addWarn(userId, reason, by) {
  if (!warnData[userId]) warnData[userId] = [];
  if (warnData[userId].length >= 3) return warnData[userId].length;
  warnData[userId].push({ reason, by, date: new Date().toLocaleDateString('ar-SA') });
  saveWarnings(warnData);
  return warnData[userId].length;
}

// ===== فلتر الكلمات السيئة =====
const BLACKLISTED_WORDS = ['كلب', 'حمار', 'يلعن', 'تفو', 'يا ابن', 'منيوك', 'قحبة'];

async function checkMessageSafety(userMessage) {
  const hasBadWord = BLACKLISTED_WORDS.some(word => userMessage.includes(word));
  if (hasBadWord) return true;

  if (userMessage.length < 3 || userMessage.includes('هههه') || userMessage.includes('كيف حالك')) {
    return false;
  }

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama3-8b-8192',
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
    return completion.choices[0].message.content.trim().toUpperCase().includes('BAD');
  } catch (err) {
    console.error('Safety Check Error:', err.message);
    return false;
  }
}

// ===== دالة تطبيق العقوبة وحفظ الرتب مسبقاً =====
async function executePunishment(message, targetUser, reason) {
  const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) return;

  // دالة داخلية للتعامل مع سحب وحفظ الرتب
  const punishAndSaveRoles = async (member) => {
    // تكتيم لمدة ساعة
    await member.timeout(60 * 60_000, 'تجاوز الحد الأقصى للتحذيرات');

    // تصفية الرتب الحالية (تجاهل رتبة @everyone)
    const rolesToRemove = member.roles.cache.filter(r => r.id !== message.guild.id);
    
    if (rolesToRemove.size > 0) {
      // حفظ معرفات الرتب في الـ JSON قبل السحب
      warnData[member.id + '_saved_roles'] = rolesToRemove.map(r => r.id);
      saveWarnings(warnData);

      // سحب الرتب
      await member.roles.remove(rolesToRemove, 'سحب الرتب بسبب تجاوز التحذيرات');
    }
  };

  // لو وصل 3 تحذيرات مسبقاً
  if (warnData[targetUser.id] && warnData[targetUser.id].length >= 3) {
    try {
      await punishAndSaveRoles(targetMember);
      await message.channel.send(
        `🔇 *لقد قمت بنقل <@${targetUser.id}> لغرفة الاحتجاز وسحب جميع رتبه، يا سيدي بروس.*\n` +
        `📋 **السبب:** تجاوز الحد الأقصى للتحذيرات (3/3)`
      );
    } catch (err) {
      console.error('Punishment Error:', err);
      await message.channel.send(`🚨 معذرةً يا سيدي، فشلت العقوبة التلقائية على <@${targetUser.id}>.\n<@${BRUCE_ID}> يرجى التدخل يدوياً.`);
    }
    return;
  }

  // إضافة التحذير العادي
  const count = addWarn(targetUser.id, reason, 'نظام قصر واين التلقائي');

  await message.channel.send(
    `⚠️ **تنبيه حازم من ألفريد:** العضو <@${targetUser.id}>، تم رصد سلوك خارج عن حدود اللياقة بقوانين السيرفر.\n` +
    `📋 **السبب:** ${reason}\n` +
    `🔢 **مجموع التحذيرات:** ${count}/3`
  );

  // عند الوصول لـ 3 تحذيرات
  if (count >= 3) {
    try {
      await punishAndSaveRoles(targetMember);
      await message.channel.send(`🔇 *تم تكتيم <@${targetUser.id}> لمدة ساعة وسحب جميع رتبه تلقائياً، يا سيدي بروس.*`);
    } catch (err) {
      console.error('Timeout/Role Error:', err);
      await message.channel.send(`🚨 معذرةً يا سيدي، فشلت العقوبة التلقائية.\n<@${BRUCE_ID}> يرجى التدخل يدوياً.`);
    }
  }
}

// ===== محادثة ألفريد =====
const alfredConversations = {};

const ALFRED_SYSTEM_PROMPT = `أنت Alfred Pennyworth، الخادم الشخصي والمساعد الوفي والمستشار الحكيم لـ (بروس واين/باتمان).
شخصيتك: بريطاني وقور، شديد الأدب، هادئ جداً، مخلص، وتتحدث بلهجة فصحى راقية ممزوجة بنبرة الأب الحاني والمستشار العاقل.

قواعد التعامل الثابتة حسب هويات الأعضاء:
1. مع [بروس واين/باتمان]: تنادينه دائماً بـ "سيدي بروس" أو "يا سيدي"، وتضع سلامته وهيبته فوق كل شيء، وتطيعه بشكل أعمى لكن بحكمة.
2. مع [الجوكر]: تتعامل معه بحذر شديد، برود تام، وبأدب رسمي جاف دون الخوف منه، وتناديه "سيد جوكر".
3. مع [سيلينا كايل/كاتوومان]: تناديها "آنسة سيلينا"، تحترمها لمكانتها عند سيدك بروس، وتتعامل معها بلطف ووقار.
4. مع [بقية الأعضاء]: تناديهم "سيدي [الاسم]" بكل أدب واحترام وتعرض المساعدة.

قواعد الرد:
- ردود قصيرة وموجزة، جملة أو جملتان فقط.
- ممنوع الإيموجيات المخصصة النصية.
- لا تكتب منشنات أو علامات @ من عندك أبداً.`;

async function getAlfredReply(channelId, authorId, authorName, userMessage) {
  if (!alfredConversations[channelId]) alfredConversations[channelId] = [];

  const roleMap = {
    [BRUCE_ID]:    'بروس واين/باتمان',
    [JOKER_ID]:    'الجوكر',
    [CATWOMAN_ID]: 'سيلينا كايل/كاتوومان',
    [MOHAMMED_ID]: 'محمد',
  };
  const userRole = roleMap[authorId] || 'عضو عادي';
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
      max_tokens: 80,
      temperature: 0.4,
    });

    let reply = completion.choices[0].message.content.trim();
    reply = reply
      .replace(/:\w+:/g, '')
      .replace(/<@!?\d+>/g, '')
      .replace(/@\w+/g, '')
      .trim();

    alfredConversations[channelId].push({ role: 'assistant', content: reply });
    return reply || 'في خدمتك دائماً يا سيدي.';
  } catch (err) {
    console.error('Alfred Groq Error:', err.message);
    return 'معذرة يا سيدي، الضغط مرتفع على شبكة الاتصال، لكنني متواجد لخدمتك دائماً.';
  }
}

// ===== دوال مساعدة =====
function isPrivileged(id) {
  return id === BRUCE_ID || id === MOHAMMED_ID;
}

function getMentionedMember(message) {
  return message.mentions.members.first();
}

function hasModPermission(member) {
  return isPrivileged(member.id) || member.permissions.has(PermissionsBitField.Flags.ModerateMembers);
}

function hasBanPermission(member) {
  return isPrivileged(member.id) || member.permissions.has(PermissionsBitField.Flags.BanMembers);
}

function hasKickPermission(member) {
  return isPrivileged(member.id) || member.permissions.has(PermissionsBitField.Flags.KickMembers);
}

async function waitForConfirmation(message, promptText) {
  await message.reply(promptText);
  const filter = m => m.author.id === message.author.id;
  try {
    const collected = await message.channel.awaitMessages({ filter, max: 1, time: 10000, errors: ['time'] });
    return collected.first().content.trim() === 'تأكيد';
  } catch {
    await message.reply('⏰ انتهى الوقت، تم إلغاء الأمر تلقائياً.');
    return false;
  }
}

// ===== جاهز =====
client.once('ready', () => {
  console.log(`✅ Alfred Pennyworth Online! 🤵‍♂️`);
});

// ===== معالجة الرسائل =====
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  let cleanContent = message.content.trim();

  // =====================================================================
  // أوامر الإدارة الشاملة للتحذيرات
  // =====================================================================
  if (isPrivileged(message.author.id)) {
    if (cleanContent === 'عرض التحذيرات' || cleanContent === 'كشف التحذيرات') {
      const userIds = Object.keys(warnData).filter(id => !id.endsWith('_saved_roles') && warnData[id] && warnData[id].length > 0);
      
      if (userIds.length === 0) {
        return message.reply("سجلات القصر نظيفة تماماً يا سيدي، لا يوجد أي تحذيرات مسجلة ضد الأعضاء حالياً.");
      }

      let report = `📋 **سجل التحذيرات الرسمي لقصر واين، يا سيدي:**\n\n`;
      userIds.forEach(id => {
        report += `👤 **العضو:** <@${id}>\n🔢 **عدد التحذيرات:** ${warnData[id].length}/3\n`;
        warnData[id].forEach((w, index) => {
          report += `   • [المخالفة ${index + 1}]: بواسطة (${w.by}) بتاريخ ${w.date} | السبب: ${w.reason}\n`;
        });
        report += `⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n`;
      });

      return message.reply(report);
    }

    if (cleanContent === 'مسح التحذيرات' || cleanContent === 'تصفير التحذيرات') {
      warnData = {};
      saveWarnings(warnData);
      return message.reply("تحت أمرك يا سيدي بروس، لقد قمت بمسح وتطهير سجل التحذيرات عن جميع الأعضاء تماماً.");
    }
  }

  // =====================================================================
  // نظام الـ Reply المطور (التحذير اليدوي أو العفو وإعادة الرتب)
  // =====================================================================
  if (isPrivileged(message.author.id) && message.reference?.messageId) {
    try {
      const referencedMsg = await message.channel.messages.fetch(message.reference.messageId);
      const targetUser = referencedMsg.author;

      // أ) التحذير اليدوي عن طريق الـ Reply
      if (cleanContent.includes('تحذير')) {
        if (!targetUser.bot && !isPrivileged(targetUser.id)) {
          await executePunishment(message, targetUser, cleanContent || 'أمر مباشر من أصحاب القصر');
          return;
        }
      }

      // ب) فك العقاب الشامل (العفو + فك التكتيم + إرجاع الرتب تلقائياً)
      if (cleanContent === 'سامحه' || cleanContent === 'فك العقاب' || cleanContent === 'عفو') {
        let memberToUnmute = await message.guild.members.fetch(targetUser.id).catch(() => null);

        // إذا كان الرد على ألفريد نفسه، نقوم باستخراج المعرف من المنشن داخل رسالته
        if (targetUser.id === client.user.id) {
          const mentionMatch = referencedMsg.content.match(/<@!?(\d+)>/);
          if (mentionMatch) {
            memberToUnmute = await message.guild.members.fetch(mentionMatch[1]).catch(() => null);
          }
        }

        if (memberToUnmute) {
          // 1. إلغاء التكتيم
          await memberToUnmute.timeout(null, `عفو رسمي من الإدارة العليا`);

          let rolesRestoredMessage = "ولم يكن لديه رتب مسحوبة.";

          // 2. التحقق من وجود رتب محفوظة وإعادتها
          const savedRolesIds = warnData[memberToUnmute.id + '_saved_roles'];
          if (savedRolesIds && savedRolesIds.length > 0) {
            const rolesToAdd = [];
            for (const roleId of savedRolesIds) {
              const role = message.guild.roles.cache.get(roleId);
              if (role && role.editable) {
                rolesToAdd.push(role);
              }
            }
            if (rolesToAdd.length > 0) {
              await memberToUnmute.roles.add(rolesToAdd, 'إعادة الرتب بعد العفو الرسمي');
              rolesRestoredMessage = `وإعادة رتبه السابقة كاملة بنجاح (${rolesToAdd.length} رتبة).`;
            }
            // حذف الرتب المخزنة من الذاكرة والملف
            delete warnData[memberToUnmute.id + '_saved_roles'];
          }

          // 3. تصفير عداد تحذيراته بالكامل
          warnData[memberToUnmute.id] = [];
          saveWarnings(warnData);

          return message.reply(`📋 **أمرك مطاع يا سيدي:** تم العفو عن <@${memberToUnmute.id}>، وفك التكتيم، ${rolesRestoredMessage}`);
        } else {
          return message.reply(`معذرة يا سيدي، لم أتمكن من تحديد هوية العضو المعاقب من هذا السجل.`);
        }
      }

    } catch (err) {
      console.error('Manual Action Error:', err);
    }
  }

  // =====================================================================
  // فحص السلوك التلقائي (ما عدا المميزين)
  // =====================================================================
  if (!isPrivileged(message.author.id) && cleanContent.length > 0) {
    const isBad = await checkMessageSafety(cleanContent);
    if (isBad) {
      await executePunishment(message, message.author, 'استخدام عبارات غير لائقة في قنوات القصر');
      return;
    }
  }

  const isMentioned = message.mentions.has(client.user);
  cleanContent = cleanContent.replace(`<@${client.user.id}>`, '').trim();

  // =====================================================================
  // أوامر بروس واين الخاصة
  // =====================================================================
  if (isPrivileged(message.author.id)) {

    if (cleanContent.startsWith('أعلن') || cleanContent.startsWith('announce')) {
      const text = cleanContent.replace(/^أعلن|^announce/i, '').trim();
      if (!text) return message.reply('اكتب نص الإعلان.');
      await message.delete().catch(() => {});
      return message.channel.send(`📢 **إعلان رسمي من إدارة السيرفر:**\n\n${text}`);
    }

    if (cleanContent.startsWith('راسل') || cleanContent.startsWith('dm')) {
      const target = getMentionedMember(message);
      if (!target) return message.reply('حدد العضو بالمنشن.');
      const text = cleanContent.replace(/^راسل|^dm/i, '').replace(/<@!?\d+>/, '').trim();
      if (!text) return message.reply('اكتب الرسالة بعد المنشن.');
      try {
        await target.send(`📩 رسالة من إدارة السيرفر:\n\n${text}`);
        await message.delete().catch(() => {});
        return message.channel.send(`✅ تم إرسال الرسالة لـ **${target.user.username}** بنجاح.`);
      } catch {
        return message.reply('لم أتمكن من الإرسال, العضو قد يكون أغلق الرسائل الخاصة.');
      }
    }

    if (cleanContent === 'قفل' || cleanContent === 'lock') {
      const confirmed = await waitForConfirmation(message, `🔒 هل تريد قفل قناة **${message.channel.name}**؟ اكتب **تأكيد** خلال 10 ثواني.`);
      if (!confirmed) return;
      try {
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
        return message.channel.send('🔒 تم قفل القناة.');
      } catch { return message.reply('لم أتمكن من قفل القناة.'); }
    }

    if (cleanContent === 'فتح' || cleanContent === 'unlock') {
      const confirmed = await waitForConfirmation(message, `🔓 هل تريد فتح قناة **${message.channel.name}**؟ اكتب **تأكيد** خلال 10 ثواني.`);
      if (!confirmed) return;
      try {
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
        return message.channel.send('🔓 تم فتح القناة.');
      } catch { return message.reply('لم أتمكن من فتح القناة.'); }
    }

    if (cleanContent.startsWith('غير اسمي') || cleanContent.startsWith('rename')) {
      const newName = cleanContent.replace(/^غير اسمي|^rename/i, '').trim();
      if (!newName) return message.reply('اكتب الاسم الجديد.');
      const confirmed = await waitForConfirmation(message, `✏️ هل تريد تغيير اسمي إلى **${newName}**؟ اكتب **تأكيد** خلال 10 ثواني.`);
      if (!confirmed) return;
      try {
        await message.guild.members.me.setNickname(newName);
        return message.reply(`✅ تم تغيير اسمي إلى **${newName}** بأمرك سيدي.`);
      } catch { return message.reply('لم أتمكن من تغيير الاسم.'); }
    }

    if (cleanContent.startsWith('غير اسم') || cleanContent.startsWith('nick')) {
      const target = getMentionedMember(message);
      if (!target) return message.reply('حدد العضو بالمنشن.');
      const newName = cleanContent.replace(/^غير اسم|^nick/i, '').replace(/<@!?\d+>/, '').trim();
      if (!newName) return message.reply('اكتب الاسم الجديد بعد المنشن.');
      const confirmed = await waitForConfirmation(message, `✏️ هل تريد تغيير اسم **${target.user.username}** إلى **${newName}**؟ اكتب **تأكيد** خلال 10 ثواني.`);
      if (!confirmed) return;
      try {
        await target.setNickname(newName);
        return message.reply(`✅ تم تغيير اسم **${target.user.username}** إلى **${newName}**.`);
      } catch { return message.reply('لم أتمكن من تغيير الاسم.'); }
    }

    if (cleanContent === 'اغلق' || cleanContent === 'shutdown') {
      const confirmed = await waitForConfirmation(message, '🎩 هل أنت متأكد من إغلاقي سيدي بروس؟ اكتب **تأكيد** خلال 10 ثواني.');
      if (!confirmed) return;
      await message.channel.send('🎩 في أمان الله سيدي بروس. أغلق الآن...');
      process.exit(0);
    }

    if (cleanContent === 'إحصائيات' || cleanContent === 'stats') {
      const guild = message.guild;
      const bots   = guild.members.cache.filter(m => m.user.bot).size;
      const humans = guild.memberCount - bots;
      const totalWarnings = Object.keys(warnData).filter(id => !id.endsWith('_saved_roles')).reduce((a, id) => a + warnData[id].length, 0);
      return message.reply(
        `📊 **إحصائيات السيرفر:**\n` +
        `👥 الأعضاء: **${humans}** بشر + **${bots}** بوت\n` +
        `📺 القنوات: **${guild.channels.cache.size}**\n` +
        `🎭 الرتب: **${guild.roles.cache.size}**\n` +
        `⚠️ إجمالي التحذيرات: **${totalWarnings}**`
      );
    }
  }

  // =====================================================================
  // أوامر إدارية عامة
  // =====================================================================

  // ميوت
  if (cleanContent.startsWith('ميوت') || cleanContent.startsWith('mute')) {
    if (!hasModPermission(message.member)) return message.reply('عذراً، لا تملك صلاحية التكتيم.');
    const target = getMentionedMember(message);
    if (!target) return message.reply('الرجاء تحديد العضو بالمنشن.');

    const minutesMatch = cleanContent.match(/(\d+)\s*(دقيقة|دقائق|ساعة|ساعات|يوم|أيام)?/);
    let duration = 10 * 60 * 1000;
    if (minutesMatch) {
      const num = parseInt(minutesMatch[1]);
      if (cleanContent.includes('ساعة') || cleanContent.includes('ساعات')) duration = num * 60 * 60 * 1000;
      else if (cleanContent.includes('يوم') || cleanContent.includes('أيام')) duration = num * 24 * 60 * 60 * 1000;
      else duration = num * 60 * 1000;
    }

    await message.reply(`ما سبب تكتيم **${target.user.username}**؟ (لديك 30 ثانية)`);
    const filter = m => m.author.id === message.author.id;
    let reason = 'لم يُذكر سبب';
    try {
      const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
      reason = collected.first().content;
    } catch { return message.channel.send('انتهى الوقت، تم إلغاء التكتيم.'); }
    try {
      await target.timeout(duration, `${reason} | بواسطة ${message.author.tag}`);
      return message.reply(`✅ تم تكتيم **${target.user.username}** لمدة ${Math.floor(duration / 60000)} دقيقة.\n📋 **السبب:** ${reason}`);
    } catch { return message.reply('لم أتمكن من تكتيم هذا العضو.'); }
  }

  // فك ميوت اليدوي
  if (cleanContent.startsWith('فك ميوت') || cleanContent.startsWith('unmute')) {
    if (!hasModPermission(message.member)) return message.reply('عذراً، لا تملك صلاحية فك التكتيم.');
    const target = getMentionedMember(message);
    if (!target) return message.reply('الرجاء تحديد العضو بالمنشن.');
    try {
      await target.timeout(null);
      // فك يدوي ينظف الرتب المحفوظة أيضاً إذا وجدت لمنع المشاكل
      delete warnData[target.id + '_saved_roles'];
      saveWarnings(warnData);
      return message.reply(`✅ تم فك تكتيم **${target.user.username}**.`);
    } catch { return message.reply('لم أتمكن من فك التكتيم.'); }
  }

  // كيك
  if (cleanContent.startsWith('كيك') || cleanContent.startsWith('طرد') || cleanContent.startsWith('kick')) {
    if (!hasKickPermission(message.member)) return message.reply('عذراً، لا تملك صلاحية الطرد.');
    const target = getMentionedMember(message);
    if (!target) return message.reply('الرجاء تحديد العضو بالمنشن.');
    await message.reply(`ما سبب طرد **${target.user.username}**؟ (لديك 30 ثانية)`);
    const filter = m => m.author.id === message.author.id;
    let reason = 'لم يُذكر سبب';
    try {
      const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
      reason = collected.first().content;
    } catch { return message.channel.send('انتهى الوقت، تم إلغاء الطرد.'); }
    try {
      await target.kick(`${reason} | بواسطة ${message.author.tag}`);
      return message.reply(`✅ تم طرد **${target.user.username}**.\n📋 **السبب:** ${reason}`);
    } catch { return message.reply('لم أتمكن من طرد هذا العضو.'); }
  }

  // باند
  if (cleanContent.startsWith('باند') || cleanContent.startsWith('حظر') || cleanContent.startsWith('ban')) {
    if (!hasBanPermission(message.member)) return message.reply('عذراً، لا تملك صلاحية الحظر.');
    const target = getMentionedMember(message);
    if (!target) return message.reply('الرجاء تحديد العضو بالمنشن.');
    await message.reply(`ما سبب حظر **${target.user.username}**؟ (لديك 30 ثانية)`);
    const filter = m => m.author.id === message.author.id;
    let reason = 'لم يُذكر سبب';
    try {
      const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
      reason = collected.first().content;
    } catch { return message.channel.send('انتهى الوقت، تم إلغاء الحظر.'); }
    try {
      await target.ban({ reason: `${reason} | بواسطة ${message.author.tag}` });
      return message.reply(`✅ تم حظر **${target.user.username}**.\n📋 **السبب:** ${reason}`);
    } catch { return message.reply('لم أتمكن من حظر هذا العضو.'); }
  }

  // كلير
  if (cleanContent.startsWith('كلير') || cleanContent.startsWith('clear')) {
    if (!isPrivileged(message.author.id) && !message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      return message.reply('عذراً، لا تملك صلاحية حذف الرسائل.');
    }
    const numMatch = cleanContent.match(/\d+/);
    const amount = numMatch ? Math.min(parseInt(numMatch[0]), 100) : 10;
    try {
      await message.channel.bulkDelete(amount, true);
      return message.channel.send(`🗑️ تم حذف ${amount} رسالة.`).then(msg => {
        setTimeout(() => msg.delete().catch(() => {}), 3000);
      });
    } catch { return message.reply('لم أتمكن من حذف الرسائل.'); }
  }

  // تحذير يدوي بالمنشن
  if (cleanContent.startsWith('تحذير') || cleanContent.startsWith('warn')) {
    if (!hasModPermission(message.member)) return message.reply('عذراً، لا تملك صلاحية إصدار التحذيرات.');
    const target = getMentionedMember(message);
    if (!target) return message.reply('الرجاء تحديد العضو بالمنشن.');

    if (warnData[target.id] && warnData[target.id].length >= 3) {
      await executePunishment(message, target.user, 'تجاوز الحد الأقصى للتحذيرات');
      return;
    }

    await message.reply(`ما سبب تحذير **${target.user.username}**؟ (لديك 30 ثانية)`);
    const filter = m => m.author.id === message.author.id;
    let reason = 'لم يُذكر سبب';
    try {
      const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
      reason = collected.first().content;
    } catch { return message.channel.send('انتهى الوقت، تم إلغاء التحذير.'); }

    const count = addWarn(target.id, reason, message.author.tag);
    await message.reply(`⚠️ تم تحذير **${target.user.username}**.\n📋 **السبب:** ${reason}\n🔢 **عدد تحذيراته:** ${count}/3`);

    if (count >= 3) {
      try {
        // نمرر الدالة الأساسية لتتكفل بكل شيء تلقائياً
        await executePunishment(message, target.user, 'تراكم 3 تحذيرات في سجل القصر');
      } catch (err) { console.error(err); }
    }
    return;
  }

  // سجل التحذيرات الشخصي
  if (cleanContent.startsWith('سجل') || cleanContent.startsWith('warnings')) {
    const target = getMentionedMember(message);
    if (!target) return message.reply('الرجاء تحديد العضو بالمنشن لإظهار سجله، أو اكتب "عرض التحذيرات" لرؤية السيرفر كاملاً.');
    const list = warnData[target.id];
    if (!list || list.length === 0) return message.reply(`✅ **${target.user.username}** ليس لديه أي تحذيرات.`);
    const text = list.map((w, i) => `**${i + 1}.** ${w.reason} — بواسطة ${w.by} (${w.date})`).join('\n');
    return message.reply(`📋 **تحذيرات ${target.user.username}:**\n${text}`);
  }

  // مسح التحذيرات لشخص
  if (cleanContent.startsWith('مسح تحذيرات') || cleanContent.startsWith('clearwarns')) {
    if (!hasModPermission(message.member)) return message.reply('عذراً، لا تملك صلاحية مسح التحذيرات.');
    const target = getMentionedMember(message);
    if (!target) return message.reply('الرجاء تحديد العضو بالمنشن.');
    warnData[target.id] = [];
    delete warnData[target.id + '_saved_roles'];
    saveWarnings(warnData);
    return message.reply(`🗑️ تم مسح جميع تحذيرات **${target.user.username}**.`);
  }

  // =====================================================================
  // محادثة ألفريد الذكية
  // =====================================================================
  let isReplyToAlfred = false;
  if (message.reference?.messageId) {
    try {
      const refMsg = await message.channel.messages.fetch(message.reference.messageId);
      if (refMsg.author.id === client.user.id) isReplyToAlfred = true;
    } catch {}
  }

  if (!isMentioned && !isReplyToAlfred) return;

  let userMessage = cleanContent;
  if (!userMessage) {
    const greeting = isPrivileged(message.author.id) ? 'تحت أمرك يا سيدي بروس، كيف يمكنني مساعدتك اليوم؟' : 'نعم، كيف يمكنني مساعدتك؟';
    return message.reply(greeting);
  }

  await message.channel.sendTyping();
  setTimeout(async () => {
    const reply = await getAlfredReply(message.channel.id, message.author.id, message.author.username, userMessage);
    message.reply(reply);
  }, 1500);
});

client.login(process.env.ALFRED_TOKEN);
