/**
 * Static site build. Everything the page needs comes from the three files
 * `npm run scrape` writes to .build/ (see src/_data/site.js); they are also
 * published verbatim under /data/ so the raw scrape can be inspected or
 * reused, and so the next run can extend the run history. So are the
 * per-source snapshots (data/sources/<id>.json), which the next run falls
 * back on for any source that fails.
 */

const BUILD_DIR = process.env.BUILD_DIR ?? ".build";

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  for (const name of ["events.json", "health.json", "history.json"]) {
    eleventyConfig.addPassthroughCopy({ [`${BUILD_DIR}/${name}`]: `data/${name}` });
  }
  eleventyConfig.addPassthroughCopy({ [`${BUILD_DIR}/sources`]: "data/sources" });

  // .build/ lives outside src/, so watch it explicitly: re-running
  // `npm run scrape` while `npm run site:dev` is up hot-reloads the preview.
  eleventyConfig.addWatchTarget(`./${BUILD_DIR}/`);

  return {
    dir: {
      input: "src",
      output: "_site",
    },
  };
}
