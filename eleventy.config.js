export default function (eleventyConfig) {
  // .build/events.json lives outside src/ (the input dir Eleventy watches
  // by default), so it needs to be added explicitly. This means running
  // `npm run scrape` again in another terminal while `npm run site:dev` is
  // active will hot-reload the preview with fresh data, no restart needed.
  eleventyConfig.addWatchTarget("./.build/events.json");

  return {
    dir: {
      input: "src",
      output: "_site",
    },
  };
}