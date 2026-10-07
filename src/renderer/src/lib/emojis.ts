// Emojis del selector del chat (propio: nada del de Windows ni del de Chromium), por categorías.

const list = (s: string): string[] => s.split(' ').filter(Boolean)

export const EMOJI_GROUPS: { id: string; icon: string; emojis: string[] }[] = [
  {
    id: 'faces',
    icon: '😀',
    emojis: list(
      '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 👾 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾 🙈 🙉 🙊'
    )
  },
  {
    id: 'people',
    icon: '👋',
    emojis: list(
      '👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🧠 👀 👁️ 👅 👄 💋 👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🧏 🙇 🤦 🤷 👮 🕵️ 💂 🥷 👷 🤴 👸 🦸 🦹 🧙 🧚 🧛 🧜 🧝 🧞 🧟 💃 🕺 🏃 🚶 🧍'
    )
  },
  {
    id: 'hearts',
    icon: '❤️',
    emojis: list('❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 💯 💢 💥 💫 💦 💨 🕳️ 💬 💭 💤 🔥 ✨ 🌟 ⭐ 🌈 ⚡ ❄️ ☄️')
  },
  {
    id: 'gaming',
    icon: '🎮',
    emojis: list(
      '🎮 🕹️ 👾 🎲 🎯 🏆 🥇 🥈 🥉 🏅 🎖️ ⚔️ 🗡️ 🛡️ 🏹 🔫 💣 🧨 🪓 🔨 ⛏️ 🧱 💎 👑 💰 🪙 💸 🚀 🛸 🛰️ 🏎️ 🏁 🚗 🏍️ ✈️ 🚁 ⛵ 🗺️ 🧭 🏰 🏯 🌋 🗿 🎰 🃏 🀄 ♟️ 🧩 🎳 ⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🥊 🥋 🎿 🏂 🏄 🎣'
    )
  },
  {
    id: 'party',
    icon: '🎉',
    emojis: list('🎉 🎊 🎈 🎁 🎂 🍰 🧁 🥳 🎆 🎇 🎃 🎄 🎅 🤶 🎵 🎶 🎤 🎧 🎸 🥁 🎹 🎺 🎻 📸 🎬 📺 🍿 🍕 🍔 🍟 🌭 🌮 🍣 🍜 🍩 🍪 🍫 🍭 🍺 🍻 🥂 🍷 🍹 ☕ 🧃 🥤')
  },
  {
    id: 'nature',
    icon: '🦊',
    emojis: list(
      '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🐺 🐗 🐴 🦄 🐝 🦋 🐌 🐞 🕷️ 🦂 🐢 🐍 🦎 🐙 🦑 🦀 🐠 🐬 🐳 🦈 🐊 🦖 🦕 🐉 🌵 🌲 🌴 🍀 🍁 🍄 🌸 🌻 🌹 🌍 🌙 🌞 🌝 ☀️ ⛅ 🌧️ ⛈️ 🌊'
    )
  },
  {
    id: 'symbols',
    icon: '✅',
    emojis: list('✅ ❌ ❗ ❓ ‼️ ⁉️ ⚠️ 🚫 ⛔ 🆗 🆕 🆒 🆓 🆙 🆘 🔝 🔜 ▶️ ⏸️ ⏹️ ⏺️ 🔁 🔀 ➕ ➖ ✖️ ➗ 💲 ♻️ 🔔 🔕 📢 💡 🔒 🔓 🔑 ⏰ ⏳ 📌 📎 🔗 🧷 🗑️ 📅 📈 📉 🏳️ 🏴 🏁 🚩')
  }
]
