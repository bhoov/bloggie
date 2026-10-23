// The blog's own styles: every .css file in its src/styles/. Base.astro imports this after styles/site.css, so these
// load after Bloggie's and win. (In its own module: Vite moves a glob's imports to the top of the file that has it.)
import.meta.glob('/src/styles/*.css', { eager: true })
