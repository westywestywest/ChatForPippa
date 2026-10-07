# PippaChat

Merge your Twitch and YouTube live chats into one OBS overlay. It runs on your own computer and needs no logins, API keys, or npm installs, just Node.js 22+.

## Setup

1. Install [Node.js](https://nodejs.org) 22 or newer.
2. Download and extract this repo.
3. Double-click **Start-PippaChat.cmd** (Windows), or run `npm start` in the folder (any OS).
4. Open http://127.0.0.1:3876, paste your Twitch channel URL and YouTube livestream URL, and click **Start merging**.
5. In OBS, add a **Browser Source** with the URL `http://127.0.0.1:3876/overlay` (480 × 800 works well).

Keep the PippaChat window open while you stream. Your settings are saved, but you'll need to click Start again after restarting it.

## Features

- Twitch chat with native emotes, GIF Keyboard GIFs, and mod deletes/timeouts
- YouTube live chat with custom emoji, Super Chats, Super Stickers and memberships
- 7TV, BTTV and FFZ emotes, global and channel (refreshed every 5 minutes)
- Badge images: Twitch sub/mod/VIP/bits badges (including the channel's custom sub badges) and YouTube member badges
- Three built-in styles, font size, message limit and fade-out timer
- Custom CSS for your own look
- Auto-reconnects if either chat drops

Not supported (yet): 7TV personal emotes.

## Custom CSS

Paste CSS into **Custom CSS** in the studio and click **Apply appearance**, or use OBS's own Custom CSS box.

```css
#log { font-family: 'Trebuchet MS', sans-serif; }
#log .chat-line { border-radius: 0; background: transparent; }
#log .name { font-weight: 800; }
#log .message { text-shadow: 0 2px 4px black; }
#log .platform { display: none; }
```

Available selectors: `#log`, `.chat-line`, `.meta`, `.name`, `.message`, `.emote`, `.badge`, `.badge-img`, `.platform`, `.amount`, `.sticker`, `.chat-gif`, `[data-platform="twitch"]`, `[data-platform="youtube"]`, `[data-from]`, `[data-user-id]`, `[data-kind]`, `.badge[data-badge="moderator"]`. GIF size can be changed with `--chat-gif-width` and `--chat-gif-height` on `#log`.

Only paste CSS you trust. It can load images and fonts from other sites.

## Good to know

- PippaChat reads public chat without logging in, so it relies on how Twitch and YouTube work right now. If either changes something, that side may stop working until it's updated. Private, members-only, or age-restricted chats won't load.
- Everything runs locally. Your settings are saved in `settings.json` in the app folder. Chat is only kept in memory and is never written to disk.
- The app only listens on your own computer (`127.0.0.1`). Don't expose it to the internet with port forwarding or tunnels.
- There's no tracking or analytics. The app connects only to Twitch, YouTube, 7TV, BTTV/FFZ (api.betterttv.net), and the image hosts they use (including GIPHY and Google Fonts).
- Twitch badge images come from [ivr.fi](https://api.ivr.fi), a free community service, because Twitch's own badge API needs a developer key. If it's down, badges show as text and chat keeps working.

## Development

```
npm test
```

PippaChat is a fan-made project. It isn't affiliated with Pippa, Twitch, YouTube, 7TV, BTTV, or FFZ.

## License

[MIT](LICENSE). Free to use, modify and share. Provided as-is, with no warranty, so use it at your own risk.
