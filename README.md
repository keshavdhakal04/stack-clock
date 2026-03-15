# ⏱️ StackClock
Track your time. Own your earnings.

🔗 **Live Demo:** [stackclock.infinityfree.me](https://stackclock.infinityfree.me)

---

## ✨ Features
- ⏱️ Live earnings counter updating every frame
- 💸 Set your hourly rate and track income in real time
- ☕ Break mode — pause earnings without ending the session
- 📋 Session history saved to your account
- 💱 Multi-currency support — CAD, USD, EUR, GBP, AUD, JPY
- 📊 Stats — work time, break time, earnings per minute
- 🔐 Auth — sign up and login with email & password
- 📱 Responsive — desktop nav + mobile bottom tabs
- 🗑️ Delete individual sessions from history
- 👋 Personalized greeting with your name in the nav

## 🛠️ Built With
- HTML5
- CSS3
- Vanilla JavaScript
- [Supabase](https://supabase.com) — auth + database
- [Google Fonts — Fraunces, DM Sans, DM Mono](https://fonts.google.com)

## 📁 File Structure
```
stackclock/
├── index.html
├── style.css
└── app.js
```

## 🗄️ Database
Two Supabase tables are required:
- **profiles** — stores name, hourly rate, and currency per user
- **sessions** — stores every tracked session with duration and earnings

## 🚀 How to Run
1. Clone the repo
```bash
git clone https://github.com/keshavdhakal04/stackclock.git
```
2. Create a Supabase project and set up `profiles` and `sessions` tables
3. Paste your Supabase URL and anon key into `app.js`
4. Open `index.html` in your browser

## 📸 Pages
| Page | Description |
|---|---|
| Tracker | Start/stop/break timer with live earnings |
| History | View and delete all past sessions |
| Settings | Set your name, rate, and currency |

## 👤 Author
**Keshav Dhakal**
- GitHub: [@keshavdhakal04](https://github.com/keshavdhakal04)
- LinkedIn: [keshav-dhakal](https://linkedin.com/in/keshav-dhakal)
