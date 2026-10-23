# My blog

A blog made with [Bloggie](https://github.com/bhoov/bloggie): interactive posts, each with an optional slide deck.

## Write

```sh
npm run dev      # http://localhost:4321/
```

The page redraws each time you save a file.
The example post, `src/pages/posts/how-this-blog-works/`, shows every feature.
Copy its folder to start a post.
Set the title and author in `src/site.js`.

## Publish

Push to `main` on GitHub, and the workflow in `.github/workflows/` publishes the site to GitHub Pages.
Once, in the repository's Settings → Pages, set the source to GitHub Actions.

`npm run build` checks every link and citation and builds the site into `dist/`.

## Update Bloggie

The engine is the npm package `bloggie`, and `npm run bloggie:update` installs its latest version.
In a blog made with `npm create bloggie <folder> -- --git`, the engine is the `bloggie/` folder instead, and `npm run bloggie:update` merges its latest version from GitHub; commit your changes to `bloggie/` first.
