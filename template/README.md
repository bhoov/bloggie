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

The engine is the `bloggie/` folder.
`npm run bloggie:update` merges its latest version from GitHub; commit your own changes first.
