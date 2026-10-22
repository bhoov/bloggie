// The words of a block as the slide editor compares them, in the page (client.js) and in the source
// (source.js), so that words selected on a slide can be found in slides.mdx. The page shows what
// smartypants made of the source (curly quotes, dashes, an ellipsis for three dots), so the
// comparison leaves out quotes, dashes, periods and ellipses on both sides, and counts any run of
// white space as one space.
//
//   canonical('A “quote” -- here.')  →  { text: 'A quote here', at: [0, 1, 3, …] }
// `at[i]` is the index in the input of the output's character i.

const DROP = /['"‘’‚′“”„″\-‐–—.…]/

export function canonical(input) {
  let text = ''
  const at = []
  let space = true // drop leading white space, and white space after white space
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (DROP.test(ch)) continue
    if (/\s/.test(ch)) {
      if (space) continue
      space = true
      text += ' '
      at.push(i)
      continue
    }
    space = false
    text += ch
    at.push(i)
  }
  if (text.endsWith(' ')) { text = text.slice(0, -1); at.pop() }
  return { text, at }
}

// The start of the n-th time `part` occurs in `text` (n from 0), or -1.
export function nth(text, part, n) {
  let at = -1
  for (let k = 0; k <= n; k++) {
    at = text.indexOf(part, at + 1)
    if (at < 0) return -1
  }
  return at
}

// How many times `part` starts in text before `end`.
export function countBefore(text, part, end) {
  let n = 0
  for (let at = text.indexOf(part); at >= 0 && at < end; at = text.indexOf(part, at + 1)) n++
  return n
}
