# Agents for Humans — submission pack

Deadline: **Monday 14 Sep 2026, 5:00pm PDT**. Credits form: **Thursday 11 Sep 2026, 12:00pm PT**.

You cannot win from code alone. Judges watch the video, skim the README, maybe click the live demo. Score every criterion on purpose.

## Track

**Professional Agents** — pick this, not Everyday.

FAQ: pick the track by *who the primary user is*. This is for someone doing skilled work (a singer / teacher running a practice session), not paying bills. Everyday will be flooded with calendar bots. The 3D coach is a creator tool.

A project can win **one** prize. Grand Prize ($10k) is scored across all tracks; track gold is $5k. Same submission, same scores.

## How judges will score you (honest)

| Criterion | If you shipped yesterday | After this pack | How to max it |
| --- | --- | --- | --- |
| **1. Technical Implementation** | Thin: one Agent, 4 tools, heuristic fallback. No AgentCore, no public git, no live URL. | Orchestrator + 3 specialist agents-as-tools + MemoryStore + drill review + Dockerfile/runtime.py | **Record the badge `Strands · Bedrock` and the agent-loop chips.** Deploy AgentCore if you can. Live demo URL. |
| **2. Design** | Strong 3D UI, incomplete loop (tuner vs melody, no reference audio, no history). | Full lesson: take → 3 scored drills → recap. Phrase picker. Teacher log. | 90-second path with no explanation needed. |
| **3. Potential Impact** | "Learn singing" is too big; DSP proxies are not a school. | Frame the **repetitive coaching loop** the agent owns | Video must say: listen → diagnose → drills → pass/retry → remember. Name the user. |
| **4. Creativity** | 3D acoustics + agent is original. Theme-stretch risk (not a background chore bot). | Own the stretch: *this is the repetitive work of a vocal coach* | One sentence on pedagogy. Honesty note on inferred anatomy. |
| **5. Presentation** | Nothing yet | Script below | Problem / who / why in the first 40s, then a working take. |
| **Bonus** | 0 | Up to **+0.6** (3 × 0.2) | Publish **3 posts on builder.aws.com** with **Agents for Humans** in the title. This is free rank. |

Stage One is pass/fail on theme + Strands. Say “Strands Agents SDK” out loud. Show a tool call. Do not look like a chatbot wrapper.

## You must do these (the code cannot)

Do them in this order. **Credits first — that window closes Sep 11.**

1. **AWS credits** — [form](https://forms.gle/ZKQUctt5oLQMhahHA) (rules also list a second form; use the one on the hackathon Resources tab). Registered Devpost account required.
2. **AWS Builder ID** — [profile.aws.amazon.com](https://profile.aws.amazon.com). Submission field is the **email** you used.
3. **Bedrock** — enable Nova Lite (and Claude if you want). Run `python agent/check_bedrock.py` until `[OK]`.
4. **GitHub public repo**
   - `git init` · add remote · push
   - **About → License = Apache-2.0** (the `LICENSE` file must be detectable at the top of the repo page)
   - Description: `Strands vocal coach — see your voice, get a practice plan`
5. **Live demo** (optional, scored) — static `frontend/dist` + public `/coach`. See `agent/DEPLOY.md`.
6. **AgentCore** (optional, scored) — `agent/Dockerfile` + `agent/runtime.py`.
7. **3 builder.aws.com posts** before the deadline. Drafts below. Title **must** contain `Agents for Humans`.
8. **Video** ≤ 5:00, public YouTube/Vimeo. Script below.
9. **Devpost submit** — fields below. Track = Professional Agents.

## Devpost fields (paste)

**Tagline**  
You sing. A Strands agent runs the lesson — diagnose, drill, pass/retry, remember.

**The problem**  
Singers who practice alone repeat the same unpaid work a teacher does: listen, diagnose, pick an exercise, forget last week. Apps either karaoke-score you or chat about singing. Nobody *does* the session.

**Who it's for**  
Amateur and working singers (and the teachers who review their logs). Professional Agents: skilled practice, not chores.

**Why it matters**  
Voice lessons are expensive and scarce. A daily 10-minute loop that is actually coached — pitch against the melody, a body cue you can see, three drills, a memory of last time — is the difference between humming and improving.

**What it does**  
- Live, client-side DSP: pitch, formants, harmonics, breath-stability proxy. Zero LLM latency while you sing.  
- 3D anatomy (educational, acoustically inferred — not medical imaging) with a target ghost.  
- Pitch scored against the **reference melody**. Three public-domain phrases.  
- A Strands **orchestrator** on Amazon Bedrock conducts the lesson: specialists `diagnose_take`, `plan_practice`, and `review_drill`, plus memory (`recall_singer` / `remember_session`). Drills are KB specs with pass criteria the app actually scores.  
- Recap + teacher-log download. Next visit starts from last time.

**How I built it**  
React + Three.js for the instrument. Pitchy + LPC in the browser. FastAPI SSE to a Strands Agents orchestrator (`vocal_coach`) with agents-as-tools and a vocal-technique KB. Amazon Bedrock for inference. AgentCore Runtime (`agent/runtime.py`) and AgentCore Memory when `AGENTCORE_MEMORY_ID` is set. Honest heuristic fallback (no fake Bedrock chips).

**What's next**  
Guided metronome for slow-notes, more songs via the librosa pipeline, AgentCore Memory strategies (user preferences) beyond session events.

## Video script (~4:00)

Record Chrome at 1080p. Voiceover is enough. **Show Bedrock connected.**

| Time | Picture | Say |
| --- | --- | --- |
| 0:00–0:20 | Title card: LetsSingAI · Professional Agents · Strands | “Singers practice the same phrase a hundred times. A teacher would listen, name the fault, and assign a drill. That loop is repetitive skilled work. We gave it to a Strands agent.” |
| 0:20–0:40 | Problem: phone in a bedroom, or a tuner app screenshot | “Karaoke apps score you. Chatbots talk about singing. Neither watches the take or remembers yesterday.” |
| 0:40–1:10 | Anatomy demo playing | “Before you sing, the app shows the instrument: breath, folds, open throat, vowel, placement. This is an acoustic model, not an X-ray.” |
| 1:10–1:25 | Hear phrase | “Public-domain Twinkle. You can hear the target.” |
| 1:25–2:20 | Start mic, Sing a take, 3D moving, pitch tab green/red, teal target dot | “While you sing, everything is client-side. Pitch is scored against the *melody*, not the nearest note. A wrong note in tune still fails.” |
| 2:20–3:20 | Stop & analyze. **Zoom the agent-loop chips.** Diagnosis, then Drill 1 card. Sing the hiss. Verdict pass/retry. | “The orchestrator is model-driven: recall, diagnose_take, plan_practice — specialists as tools. Then it *runs* the drills. I sing the hiss; the agent scores pass criteria and decides retry or next.” |
| 3:20–3:40 | Recap + last-time strip. Architecture SVG | “It remembers. Next session starts from last time. Bedrock in the loop; AgentCore Runtime when we deploy. Raw audio never leaves the browser.” |
| 3:40–4:00 | End card: github URL, live demo if any | “LetsSingAI. You sing. The agent runs the lesson.” |

If Bedrock is slow, cut a take you already recorded plus `__simulateTake()` in dev for the coach panel — but **one real mic take must be in the video.**

## builder.aws.com posts (publish 3)

Each title includes **Agents for Humans**. 400–800 words. Screenshots: anatomy, agent-loop chips, `/health` bedrock-agent.

### 1. Title: `Agents for Humans: a Strands vocal coach that watches the take`

How I used Strands Agents SDK as a session conductor with specialist agents-as-tools (`diagnose_take`, `plan_practice`, `review_drill`) plus a MemoryStore, instead of one chat completion. Why live DSP stays off the LLM. Link the repo.

### 2. Title: `Agents for Humans: scoring pitch against the melody, not the tuner`

The product lesson: nearest-semitone cents lie. How the browser compares f0 to the reference frame at t, and how that JSON is what the agent reasons over. Why the agent never sees raw audio.

### 3. Title: `Agents for Humans: from FastAPI SSE to Bedrock AgentCore`

Local loop: Vite + uvicorn + `check_bedrock.py`. Dockerfile + `runtime.py` (`BedrockAgentCoreApp`). MemoryStore: JSON locally, AgentCore Memory when `AGENTCORE_MEMORY_ID` is set. Honest heuristic fallback — no fake tool theatre.

## Architecture diagram (upload this)

Use [docs/architecture.svg](docs/architecture.svg) on Devpost. It has: user, UI, Strands loop, tools, Bedrock/AgentCore, output.

## GitHub About box

- Description: `Strands session conductor: you sing, the agent runs the vocal lesson`
- Website: live demo if you have one
- License: Apache-2.0 (select it so the badge shows)

```bash
cd D:\Downloads\LetsSingAI
git init
git add .
git commit -m "LetsSingAI: Strands vocal coach for Agents for Humans"
# create public repo on GitHub, then:
git branch -M main
git remote add origin https://github.com/<you>/LetsSingAI.git
git push -u origin main
```

## Recording checklist (night before)

- [ ] `check_bedrock.py` → `[OK]`
- [ ] Coach badge reads **Strands · Bedrock**
- [ ] Agent-loop chips appear (`diagnose take`, `plan practice`, …)
- [ ] Play along is on; teal target dot visible on Pitch tab
- [ ] Wrong-note miss is visible if you deliberately sing a fifth
- [ ] Anatomy disclaimer readable
- [ ] README architecture image loads
- [ ] Repo public + Apache license badge
- [ ] Three builder.aws posts live
- [ ] Video public, pitch covers problem / who / why
- [ ] Devpost track = Professional Agents
- [ ] Builder ID email filled
