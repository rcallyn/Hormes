# Hormes

**Hormes is a voice-first personal assistant for students, for Windows.** It knows the classes you are taking,
reads your lecture slides, homework and notes, and helps you study, do homework and get through the day without
the busy work: recalling context, preparing for class, switching between tasks.

Hormes continues the project [Taz33m](https://github.com/Taz33m) and I started at **c0mpiled-15**, a hackathon at
Penn State. The hackathon build was a Mac app. This repository takes it to Windows and builds it out into a study
assistant.

## What it does

- **Knows your classes.** Each class is a folder under `~/Hormes/Courses`. Hormes reads and indexes everything in
  it: lecture slides (PDF and PowerPoint, with speaker notes), homework, exams, syllabi, readings, notebooks and
  code. When it answers a question, it says which file and which slide or page it used.
- **Helps with homework.** It explains what an assignment asks and points you to the lectures that cover it. On
  graded work it coaches you toward your own answer.
- **Explains in handwriting.** For math-heavy classes, explanations and worked solutions appear on the notch in
  handwriting with typeset math. The notch grows to fit them, and each one is saved to the class's `Notes`
  folder.
- **Study and exam prep.** It builds practice exams, study guides, quizzes and weekly reviews from your own course
  materials, and saves them in the class folder.
- **Transcribes lectures and meetings.** It records from the microphone, or from computer audio for online
  lectures and calls. Transcription runs on your PC with Whisper. Transcripts go into the class folder and become
  searchable.
- **Reminds you before you have to remember.** A morning brief and an evening "tomorrow" brief; a heads-up
  15 minutes before class; an offer to turn a lecture into notes once class ends; homework due; exams coming up;
  course files that land in Downloads. All are notifications only, and you can turn them off on the School page.
- **Works with [stits](https://github.com/rcallyn/stits).** Hormes can use stits as its planner. It shares stits'
  todos and calendar, including the Canvas assignments stits brings in, so a change made in either app shows up
  in the other. Reminders and homework help use those due dates, and you can ask Hormes to add or move things.
- **Helps you switch tasks.** "Where was I?" catches you up across classes. "File my downloads" puts new course
  files into the right class folder.
- **Uses your computer.** Hormes can also carry out tasks in other apps. Every action goes through one central
  policy, and sensitive actions need your confirmation with Windows Hello.

## Run it

Requires Windows 10 or 11, the .NET 10 SDK, Node 24+ and pnpm 10 (`npm i -g pnpm@10`). Hormes reads PDFs with
`pdftotext`, which ships with Git for Windows.

```sh
git clone -c core.longpaths=true https://github.com/rcallyn/Hormes.git
cd Hormes
pnpm install
dotnet run --project apps/windows/Hormes.Windows
```

The app starts the Hormes engine (`hormesd`) and talks to it over a named pipe. The brain is Claude Code on your
Claude login. Voice is recognised on your PC by Whisper; the model, about 570 MB, downloads on first run. Spoken
replies are optional and use ElevenLabs, with the key kept in `~/.hormes/env`.

**Add your classes.** Open the Console's School page and press **Open course folder**. Make one folder per class,
for example `CS 161 - Operating Systems`, and put its slides, homework and notes inside. An optional `course.json`
names the class and can turn on handwritten explanations:

```json
{ "title": "Discrete Mathematics", "code": "CMPSC 360", "handwriting": true }
```

**Connect stits (optional).** If you use stits, switch the planner to **stits** in Settings or with the
**Hormes | stits** control on the Calendar, Todos and School pages. Hormes finds the stits database through
`STITS_DATABASE_URL`, or the `.env.local` in your stits checkout, and the connection string never leaves the
engine. Without stits, Hormes keeps its own todos and calendar on your PC.

Then ask: "what did lecture 9 say about stars and bars?", "help me start HW 6", or "make me a practice exam
for STAT 418".

## Privacy

Settings and keys live under `~/.hormes`. Only the private `env` file holds keys, and they never appear in the
Console, in tool results or in the processes Hormes starts. Course files stay on your PC. Audio is transcribed
locally and is not kept.

## Learn more

- [`apps/windows/README.md`](apps/windows/README.md): the Windows app, notch, voice and checks
- [`docs/COURSES.md`](docs/COURSES.md): the course library, reminders, recording and handwritten explanations
- [`AGENTS.md`](AGENTS.md): how the engine works, and the rules for working on it

The original Mac app from the hackathon is still in `apps/mac`, but Windows is what this repository targets.

Hormes is licensed under [MIT](LICENSE).
