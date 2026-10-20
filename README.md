<p align="center">
  <img src="apps/desktop/public/icon.png" alt="AgentUp" width="128" />
</p>

# AgentUp

[中文](README_CN.md)

**Your AI companions — use AI the way you use WhatsApp.**

Study, write, look things up, plan a trip. Each assistant handles one kind of job. When the ask spans topics, it brings in another helper.

- Add assistants to your contacts like friends
- One assistant, one kind of chat. No mixing.
- It can read files on your computer and save results there

**[Download for Mac](https://downloads.agentup.me/desktop/mac/latest/AgentUp-arm64.dmg)** · **[agentup.me](https://agentup.me)**

<p align="center">
  <img src="docs/images/feature-hero.png" alt="AgentUp desktop — contacts and multi-assistant chat" width="640" />
</p>

---

## Add an assistant

**Add them like friends. No setup maze.**

You add a specialist that keeps getting better. When they improve, your side updates too. No redo.

<p align="center">
  <img src="docs/images/feature-add-assistant.png" alt="Find a specialist and start chatting" width="640" />
</p>

- **The right helper for each job** — Papers, code, and weather each get their own assistant.
- **Add once, come back anytime** — Same kind of ask goes back to the same chat. When they update, you do nothing.
- **Ready to chat when you find them** — They come ready to help. You do not need to learn settings first.

## One chat at a time

**Same question. Two ways to chat. Two answers.**

Cram papers, code, and work plans into one assistant, and even “do I need an umbrella?” goes sideways. Chat separately, and the answer gets clear.

<p align="center">
  <img src="docs/images/feature-one-chat.png" alt="One all-in-one AI vs many separate AIs" width="640" />
</p>

- **Each assistant remembers one kind of thing** — Ask the weather helper, and it will not dig up last week’s paper chat.
- **Chats stay separate** — Whoever you ask, only that chat’s history comes along.
- **Same ask, different answers** — The all-in-one drifts. The right helper just tells you about the umbrella.

## On your computer

**More than chat. It can work on your PC.**

The assistant runs on your own computer. It can see desktop files, then put a PPT or other results right back on your desktop.

<p align="center">
  <img src="docs/images/feature-on-computer.png" alt="Agent reads desktop files and writes results back" width="640" />
</p>

- **Sees your files** — Notes and research on your desktop can be opened and used.
- **Works on your computer** — Organize, create, and save happen here, not only in a web chat.
- **Results show up on your desktop** — Finished PPT and charts land in your folders, ready to open.

Chats stay on your computer by default. We do not keep the message body. If an outside service is needed, only what the job needs goes out.

---

## This repository

Open-source **desktop** (Electron + Vue) and **runtime** (local Node supervisor).

```bash
pnpm install
sh sh/start-desktop.sh --dev    # local UI + runtime
# or
sh sh/build-mac.sh --dev        # unsigned macOS arm64 build → dist/mac/
```

Requires Node and [pnpm](https://pnpm.io) (see `packageManager` in `package.json`).

Start by picking the right person for each job — add your first assistant today.

*Use AI like you message people.*
