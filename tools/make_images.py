"""Make the exercise photos in images/exercises/ from the dataset's originals.

One-off tool. Unlike the app itself it needs one install on this PC: Pillow
(`py -m pip install pillow`). Run from the repo root:

    py tools/make_images.py path/to/free-exercise-db.tar.gz

The archive is the source of free-exercise-db at the commit named in
data/README.md, downloaded from
https://codeload.github.com/yuhonas/free-exercise-db/tar.gz/<commit>

Every photo listed in data/exercises.json is read straight from the archive
(nothing else is unpacked), shrunk to 640 px wide and written as a JPEG to
images/exercises/<exercise id>/<n>.jpg. The originals are 850 px wide and
99 MB in total; at 640 px they are about half that and still sharp on a phone.
"""

import io
import json
import re
import sys
import tarfile
from pathlib import Path

from PIL import Image

WIDTH = 640
QUALITY = 72
SAFE_PATH = re.compile(r'^[A-Za-z0-9_.\-]+/[0-9]+\.jpg$')

root = Path(__file__).resolve().parent.parent
out = root / 'images' / 'exercises'


def main(archive_path):
    dataset = json.loads((root / 'data' / 'exercises.json').read_text(encoding='utf-8'))
    wanted = {image for exercise in dataset for image in exercise.get('images', [])}
    for path in wanted:
        if not SAFE_PATH.match(path):
            raise SystemExit(f'Unexpected image path in the dataset: {path!r}')

    written = 0
    total_bytes = 0
    with tarfile.open(archive_path, 'r:gz') as archive:
        for member in archive:
            if not member.isfile() or '/exercises/' not in member.name:
                continue
            path = member.name.split('/exercises/', 1)[1]
            # Only the top-level exercises/ folder, and only photos the dataset lists.
            if member.name.count('/exercises/') != 1 or member.name.split('/')[1] != 'exercises' or path not in wanted:
                continue
            image = Image.open(io.BytesIO(archive.extractfile(member).read())).convert('RGB')
            if image.width > WIDTH:
                image = image.resize((WIDTH, round(image.height * WIDTH / image.width)), Image.LANCZOS)
            target = out / path
            target.parent.mkdir(parents=True, exist_ok=True)
            image.save(target, 'JPEG', quality=QUALITY, optimize=True, progressive=True)
            written += 1
            total_bytes += target.stat().st_size
            wanted.discard(path)

    print(f'{written} photos written to {out} ({total_bytes / 1e6:.1f} MB)')
    if wanted:
        raise SystemExit(f'{len(wanted)} photos listed in the dataset were not in the archive, e.g. {sorted(wanted)[:3]}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
