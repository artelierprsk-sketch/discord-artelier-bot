import cron from "node-cron";
import { MESSAGE_DEFINITIONS } from "../services/messageDIfinitions.mjs";

const lastPostedMessageIds = new Map();

async function fetchTargetChannel(client, channelId) {
  const channel = await client.channels.fetch(channelId);
  return channel?.isTextBased() ? channel : null;
}

async function deletePreviousFixMessage(client, defIndex) {
  const messageId = lastPostedMessageIds.get(defIndex);
  const def = MESSAGE_DEFINITIONS[defIndex];
  const channel = await fetchTargetChannel(client, def.channelId);
  if (!channel) {
    lastPostedMessageIds.delete(defIndex);
    return false;
  }

  // 1) まずIDで探す
  if (messageId) {
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (message) {
      if (message.author.id === client.user.id) {
        await message.delete().catch(() => null);
        lastPostedMessageIds.delete(defIndex);
        return true;
      }

      // ID は存在するが自身のメッセージではない -> 登録を削除して内容検索へ
      lastPostedMessageIds.delete(defIndex);
    }
    // message が null -> 続けて内容検索
  }

  // 2) IDで見つからなければ、内容一致で自身のメッセージを探す
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return false;

  const found = messages.find(m => m.author.id === client.user.id && m.content === def.message);
  if (found) {
    await found.delete().catch(() => null);
    lastPostedMessageIds.delete(defIndex);
    return true;
  }

  // 3) どちらでも見つからなければ fix 動作は行わない
  return false;
}

async function postDefinitionMessage(client, def, defIndex) {
  const channel = await fetchTargetChannel(client, def.channelId);
  if (!channel) return null;

  const sent = await channel.send({
    content: def.message,
    allowedMentions: { users: [], roles: [] },
  });

  if (def.fix && sent) {
    lastPostedMessageIds.set(defIndex, sent.id);
  }

  return sent;
}

export function startMessagePostCron(client) {
  for (const [index, def] of MESSAGE_DEFINITIONS.entries()) {
    if (!def.cron) continue;

    cron.schedule(def.cron, async () => {
      try {
        // console.log(`⏳ messagePostCron start: channel=${def.channelId} cron=${def.cron}`);
        await postDefinitionMessage(client, def, index);
        // console.log(`✅ messagePostCron finished: channel=${def.channelId}`);
      } catch (err) {
        console.error("❌ messagePostCron error", err);
      }
    }, {
      timezone: "Asia/Tokyo",
    });
  }
}

export function setupMessageFixWatcher(client) {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const targets = MESSAGE_DEFINITIONS
      .map((def, index) => ({ def, index }))
      .filter(({ def }) => def.fix && def.channelId === message.channelId);

    if (!targets.length) return;

    for (const { def, index } of targets) {
      try {
          const deleted = await deletePreviousFixMessage(client, index);
          if (deleted) {
            await postDefinitionMessage(client, def, index);
          } else {
            // console.log(`ℹ️ fix skip: target not found by id or content for channel=${def.channelId}`);
          }
      } catch (err) {
        console.error("❌ messageFixWatcher error", err);
      }
    }
  });
}
