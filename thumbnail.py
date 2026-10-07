import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / 'python-libs'))
try:
    import pyvips
except ImportError:
    pyvips = None
if pyvips is not None:
    pyvips.cache_set_max_mem(64 * 1024 * 1024)
    pyvips.cache_set_max(0)
    picture = pyvips.Image.thumbnail(sys.argv[1], 640, height=640, size='down')
    if picture.hasalpha():
        picture = picture.flatten(background=[255, 255, 255])
    picture.jpegsave(sys.argv[2], Q=87, strip=True)
else:
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = 80_000_000
    with Image.open(sys.argv[1]) as image:
        image.seek(0)
        image.thumbnail((640, 640))
        picture = ImageOps.exif_transpose(image).convert('RGBA')
        background = Image.new('RGB', picture.size, 'white')
        background.paste(picture, mask=picture.getchannel('A'))
        background.save(sys.argv[2], 'JPEG', quality=87)
