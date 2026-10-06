# Third-party analytics assets

## Country flags

- Source: `lipis/flag-icons`
- Package: `flag-icons@7.5.0`
- Upstream tag commit: `50a8bff005239b0d2d661254094dedb9c75dbef3`
- License: MIT; the complete text is retained in `docs/licenses/flag-icons-MIT.txt`.
- Use: the full 4x3 and 1x1 flag set is bundled locally by Vite from the package CSS. The application does not hotlink flag images.

## Browser logos

- Source: `alrra/browser-logos`
- Verified source snapshot: `58881b84c4d73adc03c06fa2c275a7abee02d935`
- Packages: Chrome 2.0.0, Edge 2.0.7, Firefox 3.0.10, Opera 1.1.11, Safari 2.1.0, Samsung Internet 4.0.6, and Internet Explorer 9–11 1.1.17.
- Verification: every imported SVG was SHA-256 compared with the matching file at the source snapshot above.
- License: project code/assets other than third-party trademarks are MIT; the complete text is retained in `docs/licenses/browser-logos-MIT.txt`. Browser names and logos remain trademarks of their respective owners.
- Use: only browsers detected by the Claritude tracker are imported, and Vite stores them in the application bundle. There are no hotlinks.

## Web Vitals

- Source: `GoogleChrome/web-vitals`
- Package: `web-vitals@5.1.0`
- Upstream tag commit: `01d477f0efaf50ffaed7079b5507ef1a466ccc55`
- License: Apache-2.0 (retained by the installed package and lockfile).
- Use: the Worker serves the bundled IIFE from `/vendor/web-vitals.js`; tracked sites never load it from a third-party CDN.

## Analytics and AI platform logos

- Sources: `simple-icons/simple-icons`, `FortAwesome/Font-Awesome`, and `lobehub/lobe-icons` at the pinned package versions in `package-lock.json`.
- Licences and exact upstream asset URLs are recorded in `public/assets/source-icons/manifest.json`.
- Use: the assets are copied into the application by `npm run assets:sources`; the application never hotlinks provider logos. Product names and logos remain trademarks of their respective owners.
