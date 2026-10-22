---
name: bloggie-slides
description: Make, revise or check the slide deck of a Bloggie post (src/pages/posts/<slug>/slides.mdx), with the post's live figures. Use when asked to make, revise or review slides from a post, or to update a deck after the post changed. Covers the story (one idea per slide), text sizes for the back of the room, full-slide interactive demos, equation slides with symbol legends, and the feedback to give on the post afterwards.
---

# Bloggie slides

## Quick start

1. Read the post, `src/pages/posts/<slug>/index.mdx`, and the example deck,
   `src/pages/posts/how-this-blog-works/slides.mdx`, which uses most slide kinds.
2. Write `src/pages/posts/<slug>/slides.mdx` beside the post (see Mechanics). A minimal deck:

   ```mdx
   ---
   layout: '@bloggie/layouts/Slides.astro'
   title: My Post (slides)
   ---

   import MyFigure from '@/figures/my-figure/MyFigure.svelte'

   # My Post

   Ada Lovelace · 22 October 2026

   ## The Takeaway in a Few Words

   - **First** supporting point
   - **Second** supporting point

   <Notes>What to say on this slide.</Notes>

   ## [demo zoom=1.5] See It Work

   <MyFigure client:visible />
   ```

3. Run `npm run dev`, then check every slide:
   `node .agents/skills/bloggie-slides/check-slides.mjs http://localhost:4321/posts/<slug>/slides/ <out-dir>`
   (nothing to install; see Checking). Look at the screenshots, fix, and check again.
4. Report the deck's URL, the slide list, and feedback on the post (see Feedback on the post).

When the post changes, revise the deck the same way: carry each change to the slides that show it, and keep the
author's layout (see the slide editor under Mechanics).

## Rules

A deck is presented to a room. The audience at the back must read every word, and the
presenter must not fight the deck. The post is the source; the deck restates its ideas one at
a time, with the post's own interactive figures.

1. **One idea per slide.** If a slide holds two ideas, it becomes two slides. No exceptions.
   A list is one idea only if every item supports the same title.
2. **Design for the back of the room.** If more than 10 lines of text could fit on the slide,
   the text is too small. On the 1600×900 stage: title 72px, body text 44px or larger, and
   nothing the audience must read below 36px. Do not shrink text to fit; split the slide.
3. **Titles are the shortest phrase that states the takeaway**, in title case. A title with
   nothing beside it spans the full width of the stage and takes at most two lines. Remove any
   width cap the site's article styles put on headings (a post's text-column `max-width`
   makes a slide title wrap to three lines in the left half of the slide).
      "Attention Is a Weighted Average", not "How the attention layer combines the values of
   the tokens". "Why the Baseline Failed", not "Why the baseline model did not succeed".
4. **Interactive demos are the center of the talk.** A demo takes the whole slide. Add a
   one-line header with the slide's main idea only if the demo does not speak for itself; when
   the demo shows a method, the header can name the method ("Gradient Descent on a Bowl"). Size the figure so that its own labels are readable from the back of the
   room, and check that its parts keep their relative scale (a node graph must not shrink
   while the token boxes beside it grow).
5. **Videos are full bleed.** A video slide has no title and no margin, and the slide
   background is the video's own background color, so slide and video look like one image.
   In general, a slide's background matches the background of any video or image that fills it.
6. **Equations are the focus of their slide, never a side comment.** Put the equation in
   straight from the post, large and centered, and make every symbol clear:
   - explain a symbol in words, or tie it by color to a label or a small figure;
   - give a tensor its shape (`p ∈ ℝ^{81×9}`);
   - do not repeat a symbol explained on the previous slide or very recently; if it returns
     much later, give a one-line reminder.
7. **Minimize builds.** Every animation is overhead for the presenter. Default to none. Use a
   build only when the slide asks a question and the build reveals the answer.
8. **Prefer a short list to cards.** Use cards only when items need a visual group that a list
   cannot give. When an item has a main idea and a description, make the size difference
   large: main idea 56px bold, description 40px in the secondary color.
9. **No kicker/section labels above titles.** Mark a new part of the talk with a divider slide
   (one large phrase, centered, such as a question), or put the part into the title. A divider
   holds at most two lines, with a small stage margin so the phrase can be large.
10. **Show the problem.** When a slide states a task, draw it: a picture of the problem, with
    a few text anchors tied to it by color or mark ("→ each node has one arrow out",
    "↻ the flag points to itself"). The picture and its anchors are one idea.
11. **A table is a figure.** When the post builds a table (an element with an id `tbl-…`), the deck shows that same
    table on its own slide, never a summary of it: `## [table] Title`, then `<PostTable id="tbl-…" />`, which the
    build copies from the post (`bloggie/lib/post-tables.js`). `build="tr:has(.baseline)"` fades matching rows in on the
    next click, the one kind of build a results table may use.
12. **Outlook sections are one list.** A "What's Next?" part is one idea, "what could come
    next", so it is one slide with a bulleted list, not one slide per item.
13. **A conclusion states why it matters.** A fact without its consequence feels random.
    Prefer "Citations Number Themselves, So Edits Never Break Them" to
    "Citations Are Numbered".
14. **Use bold, tastefully, to draw the eye to the main point.** The audience reads a slide in
    a glance, so bold the phrase that carries the slide's point: in a statement, its one or two
    key terms ("the walker **stays at the flag**"); in a list, the anchor
    phrase of each item ("**Noise** to escape local minima"); in a legend, the line that states
    the result ("each output row is **a weighted average of values**"); in a demo note, the verb that
    names what happens ("each loop **replaces** the belief"). Bold is a pointer, not a
    decoration: at most one phrase per item or sentence, never a whole list or paragraph, and
    never the words the title already says. Bold renders in primary ink, so it stands out even
    inside secondary-colored text.
15. **Show an example where you introduce something.** When a slide names a syntax, a rule or a
    tool, the working example is on the same slide, or on the very next one. A description without
    its example is bad taste. Only deliberate foreshadowing, which the talk pays off soon, may
    delay an example. The same holds for the post itself.
16. **Transitions come from order, not from text.** Each slide should make the next one feel
   necessary. When it does not, a motivation is missing: add a slide for it, and report it to
   the author (see Feedback).
17. **Code is shown with syntax highlighting, if it is shown at all.** Code in one color is hard
    to read from the back of the room. Show code only in a fenced block whose language colors it
    in the rendered slide, and look at the result: a grammar can leave a snippet in one color.
    Something that is not code (a folder tree, a file name, a branch name) is text or a list, not
    a code block; do not use inline code on a slide.

## Mechanics in a Bloggie blog

These apply to a blog built with Bloggie (Astro, MDX posts, Svelte figures). For another site, reuse
its figure components the same way: the deck must run the post's real interactive figures.

- A deck is `slides.mdx` beside the post's `index.mdx` (`src/pages/posts/<slug>/slides.mdx`), with
  `layout: '@bloggie/layouts/Slides.astro'` in its front matter; Astro serves it at
  `/posts/<slug>/slides/`. The pairing is automatic: when `slides.mdx` exists, the post's byline
  links to the deck and S on the post opens it; Esc (or ✕) on the deck returns to the post, with
  its scroll position when the reader came from it. A post without a deck has neither, and
  `slides: false` in a post's front matter hides a deck that exists. `bloggie/lib/slides.js` is the
  engine and `bloggie/styles/slides.css` the styles. To present, press ▶ Present (or F): this window
  goes full screen for the room; the cursor shows while the mouse moves, and the nav only while the
  mouse is at the bottom of the screen. Esc or ✕ leaves full screen. Speaker view
  (P) opens a second window with the notes, what comes next and a clock; keys in either window
  move both, and Esc closes it. Other keys: → / ← move, N notes, Esc back to the post.
- The deck of "How this blog works" (`src/pages/posts/how-this-blog-works/slides.mdx`) is the
  example: it uses most slide kinds (code, demo, equation, list, reasons, table, divider, and a
  hand-written `<Slide>`), and the post shows its source.
- Write slides with the heading shorthand (`bloggie/lib/slide-headings.js`, on files named
  `slides.mdx`): the first `#` is the title slide (the paragraph under it is the byline), a later
  `#` is a divider, and `##` starts a slide that runs to the next `#` or `##`.
  `## [kind key=value …] Title` sets the kind and its settings. The heading keeps its Markdown,
  so a title can hold math. Everything under the heading is the slide's body: Markdown, math,
  figure tags, and `<Notes>`. The plugin imports `Slide` and `Notes`, and `<PostTable>` needs no
  import (the build replaces it with the post's table); import figures, `Mark` and any picture of your own at the
  top of the deck, as the Quick start shows.


- Every shorthand slide becomes the `<Slide>` component (`bloggie/components/slides/Slide.astro`),
  and a hand-written `<Slide kind="…" title="…">` with a Markdown body (blank lines inside its
  tags) works anywhere between them, for a slide the shorthand does not cover.
- Kinds (`Slide.astro` documents every prop):
  - `title` (the first `#`): the talk title (may hold `<br />`) and the byline under it.
  - `divider` (a later `#`): one large centered phrase, at most two lines (`<br />` sets the break).
  - `text` (a `##` with no tag): a title and a short list (at most about 5 items), or one statement
    paragraph, which renders large in the secondary color.
  - `reasons`: a list whose items start with `**Main idea**`, then the description; the main idea
    renders large above the description.
  - `equation`: one `$$ … $$` display equation, then a legend list whose items start with the
    `$symbol$` they explain (it takes a symbol column); an item that starts with words is a plain
    line. `[equation eqSize=46]` shrinks a long equation. Color a symbol by its role, as the post does, with the role
    macros the blog lists in `src/roles.js` (`\given{X}` for a role named `given`); `npm run build` fails where the deck writes a colored symbol without its role.
  - `problem`: a picture of the task first (a component of your own in `src/components/slides/`), then a list of
    text anchors, each starting with `<Mark kind="…" />` to tie it to the picture (the kinds are listed in
    `bloggie/components/slides/Mark.astro`; add one there for a new picture).
  - `demo`: an optional one-line `title` over a figure tag copied from the post (for example
    `<PointerChase client:visible model="transformer" />` in the example deck). `zoom`
    sizes the figure so its labels read from the back of the room; `svgMax` caps its SVG heights
    before zoom. A slide-only description over the figure's empty region is
    `<p slot="note">…</p>`, placed with `noteTop=310px` (from the top of the figure area); one
    sentence. It scrolls with the figure, so it never covers text the figure scrolls up.
  - `video`: only the `<video>`, full bleed on `bg` (sample the color from the poster image);
    the heading is not shown, and names the slide in the speaker view.
- A `title` prop on a hand-written `<Slide>` is HTML, not Markdown; a heading title can hold math.
- Code blocks are highlighted by Shiki at build time; the fence's language picks the grammar
  (rule 16), and the syntax a slide teaches must be the part that is colored. Fence MDX source as
  `mdx`: the repo's own grammar (`bloggie/lib/shiki-mdx.js`) colors imports and component tags as TSX
  and the TeX in `$ … $` and `$$ … $$` as LaTeX. Fence shell commands as `sh`. A fence with no
  language renders as `plaintext`, in one color. A code block's text size follows its length (up
  to 3 lines at 56px, up to 6 at 44px, else 36px), so a short example fills the stage; give it
  the comments that explain it (`npm run dev   # http://localhost:4321`). After a change to the
  grammar or `astro.config.mjs`, restart `npm run dev`: it keeps the highlighter it started with.
- Bold follows rule 13: one key phrase per item or statement (`**…**`); bold text renders in primary ink, so it
  stands out even in secondary-colored statements and legends. Do not bold whole lists.
- `<Notes>` holds the speaker notes: the details, numbers and demo instructions the slide leaves
  out. MDX rules: comments are `{/* … */}`, and literal braces in notes are `\{ \}`.
- The author can lay out slides by hand in the slide editor (E on a deck under `npm run dev`;
  `bloggie/editor/`). It writes CSS into `slides.mdx`: `<Box style="…">` around a block or a figure tag,
  a `style` attribute on an element such as `<p slot="note">`, `titleStyle="…"` in a heading's tag,
  `<span style="color: …">` around words it colored, and `<Box inner="<selector> { … }">` for
  elements inside a block, such as a figure's labels or a
  list's `<Mark>`s (each selector starts at a child of the block's element). A Box renders no element;
  its style goes on the element it holds. When you revise a deck, keep these as they are: they are
  the author's layout, not yours to normalize. A Box's `inner` rules follow the figure's markup, so
  when you change a figure's markup, check the slides that style it.
- A figure on a slide is told `medium="slide"` (the deck passes it to every figure tag; a post's
  figure is `medium="blog"`). When a slide needs a figure to differ from the post (fewer panels, larger
  labels, a different layout, starting over each time the slide is shown), give the figure a slide
  version under `medium === 'slide'`, or CSS under `[data-medium="slide"]`, rather than a second
  component. Change the post's version only when the post needs it too.

## Procedure

1. Read the whole post. List its ideas in order, one line each. Mark each as text, equation
   or demo. An equation in the post that carries an idea gets its own slide.
2. For each idea, write the shortest takeaway title. If two ideas want the same slide, split.
3. Note every place where the next slide does not follow from the previous one. Add the
   missing motivation as a slide and keep the note for the feedback.
4. Write the slides. Symbols: track where each was last explained.
5. Render and check every slide at 1600×900 (see below). Fix overflow by splitting or by
   sizing the demo, never by reducing text below the sizes in rule 2.
6. Report to the user: the deck link, the slide list, and the feedback.

## Checking

Serve the site (`npm run dev`) and run
`node .agents/skills/bloggie-slides/check-slides.mjs http://localhost:4321/posts/<slug>/slides/ <out-dir>`.
It needs no install: it drives a headless Chromium (Playwright's cached one, Google Chrome, or Chromium; `$CHROME`
picks another) through `bloggie/e2e/browser.js`, as `npm run e2e` does. Keep `<out-dir>` outside the repository.
It renders each slide at 1600×936 (the stage at scale 1) with every build shown, screenshots
it, and flags a slide that fails these checks:

- no element overflows the stage (`scrollHeight > clientHeight` on the slide or a `.demo`);
- the smallest computed `font-size` of text outside `.demo` is at least 36px;
- no title or divider heading takes more than two lines;
- a demo's controls and labels are legible in the screenshot;
- every KaTeX block rendered (no `.katex-error`);
- every code block is highlighted (at least two token colors) and the slide has no inline code
  (rule 16); then look at the screenshot to see that the syntax the slide teaches is colored.

Look at the screenshots; the numbers do not show a crowded or unbalanced slide. If a slide
renders garbled markup that its source does not contain, the dev server is serving a stale
render: stop it, restart `npm run dev`, and check again before editing the source.

## Feedback on the post

After the deck is made, always give the author feedback on the post's story: the transitions
and motivations the one-idea-per-slide pass revealed as missing or weak, ideas the post states
twice or buries inside another paragraph, symbols it uses before it defines them, and titles
that could state their takeaway. For each point, name the section and propose the sentence or
paragraph to add. Do not edit the post unless asked.
