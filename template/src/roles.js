// This blog's symbol roles: the role a math symbol plays, one color each, the same in every post and deck. Bloggie reads
// them (bloggie/lib/roles.js): each `name` is a TeX macro, `$\given{X}$`, and Post.astro shows a key of the roles a post
// uses under its byline. `example` is the symbol <RoleKey /> shows; `light` and `dark` are the colors. Rename, add or
// remove roles to suit your posts; `npm run build` checks that each colored symbol keeps its role.
//
// The colors are the dataviz skill's reference palette, checked for color-vision deficiency and for 3:1 contrast on the
// page in both modes. Check a new color the same way.
export const roles = [
  { name: 'given', label: 'input', meaning: 'what the data fixes', example: 'X', light: '#4a3aa7', dark: '#c4b5fd' },
  { name: 'coupling', label: 'weights', meaning: 'what training learns', example: 'W', light: '#eb6834', dark: '#d95926' },
  { name: 'state', label: 'output', meaning: 'what the model computes', example: 'Y', light: '#2a78d6', dark: '#3987e5' },
]
