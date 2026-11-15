# lib/

Third-party code, vendored (copied in) so the app never loads anything from another site. Never edit these files by hand.

## chart.umd.min.js — Chart.js

- Version: **4.6.1**
- Source: the official npm package, `https://registry.npmjs.org/chart.js/-/chart.js-4.6.1.tgz`, file `dist/chart.umd.min.js`, unmodified. The package's SHA-1 was checked against the registry (`40a924bc0b92544ed66fa3f4873981152fc62c52`).
- SHA-256 of the file: `87364cc2b2a76a6684929e7d6b80b18a897794db38400caff1fcf1791c6925d2`
- Licence: MIT (below). The file also contains `@kurkle/color` (MIT), which Chart.js bundles.
- Used by: `js/ui/chart.js`, which loads it only when a chart is first shown.
- No date adapter is vendored: the charts use plain number axes (days) and format the dates themselves.

**To update:** download the new package from the npm registry, check its checksum against the registry, replace the file, update the version and checksums here, bump `APP_VERSION`, and run both test commands.

### Chart.js licence

The MIT License (MIT)

Copyright (c) 2014-2024 Chart.js Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
