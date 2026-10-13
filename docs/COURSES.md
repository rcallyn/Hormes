# Courses: Hormes as a study assistant

Hormes knows your classes from your files. Each class is one folder; everything in it (lecture slides, homework, exams,
syllabi, readings, notes, recorded lecture transcripts) is indexed and searchable by the brain, with the file and the
slide or page cited in every answer.

## Setting it up

```
~/Hormes/Courses/                 (HORMES_COURSES_DIR moves it)
  CS 161 - Operating Systems/     "CODE - Title" names the code and the title
    course.json                   optional: {"title","code","aliases":["os"],"instructor","meets","notes"}
    Lectures/lec03-scheduling.pptx
    Homework/hw2.pdf
    Transcripts/2026-10-12 0900 CS 161 lecture.md   (written by Record lecture)
  ECON 201 - Microeconomics/
  Meetings/Transcripts/…          meetings recorded with no course
```

Read formats: PDF (`pdftotext` from Poppler when on PATH; Git for Windows ships it. Otherwise a built-in reader handles
simple fonts), PowerPoint `.pptx` (slides plus speaker notes), Word `.docx`, Jupyter `.ipynb`, HTML, Markdown, text,
LaTeX and source code. Old `.ppt`/`.doc` files and scanned PDFs are listed as unreadable; export them to PDF or PPTX.

The library never follows links, never reads dotfiles or secret-named files (`.env*`, keys, `credentials*`), writes
nothing beside your files, and keeps its index in `<stateDir>/courses/index.json` (refreshed by size and mtime).

## What the brain can do (`courses` tool, read-only, policy `run`)

- `list`: each course with file counts by kind, recent files, homework due and next class events. Planner todos and
  events are joined to a course when their title names its code, title or an alias, which covers Canvas assignments
  synced through stits.
- `files {course?, kind?}`, `search {query, course?, kind?, limit?}` (BM25, at most three passages a file),
  `read {file, loc?, maxChars?}` (from a slide or page on).
- Kinds: lecture, transcript, homework, exam, syllabus, reading, notes, solution, lab, other (from the path).

The tool description tells every brain to search before answering coursework and to cite file and location. Study
sessions (`study`/`exam`/`review`) get the tool too, and there a `search` or `read` result becomes a work source of kind
`course`, so flashcard decks, quizzes and study artifacts can cite the slides they came from. The local brain leaves the
tool out, as it does the planner, to keep its tool table within a small context.

## Proactive nudges (engine, `courses/nudges.ts`)

A notification only: it opens no voice session, runs no tool and changes nothing. Each item fires once, and at most six
fire a day. They are on as soon as a course folder exists (setting `courseNudges`, default on; the School page checkbox turns them
off), and off while you've asked for quiet or the machine sleeps:

- a morning brief from 7 am: today's classes and school work due today or tomorrow (nothing on an empty day);
- a class event naming a course, 15 minutes before it starts, with the last lecture file and what is due next;
- school homework due tomorrow (from 5 pm) or today (from 8 am), with the matching homework file;
- an exam, midterm, final, quiz or test one to three days out (from 9 am).

## Windows

School page: Prep me for class, Help with homework (coaching, not handing over answers), Exam study guide, Quiz me,
Plan my week, What's due next, Open course folder, and **Record lecture**. Recording transcribes on this PC with the
voice turn's Whisper model, in chunks of 25 to 40 seconds cut at a pause, into the course's `Transcripts` folder. On stop,
Hormes is asked for clean notes and any announced deadlines. Ask before recording other people.

## Captured lectures (Mac and Windows)

Lectures and meetings Hormes captured in a work session (the Mac's lecture and meeting capture) are indexed too, as
`<course>/Captured/<date> <title>.md` transcripts under the session's course (or a "Captured lectures and meetings"
course), read from the work store; nothing is written into the course folders. This needs the courses root to exist.
