import type { FilmstripLayout } from '../../model/filmstrip';
import { filmstripRange } from '../../model/filmstrip';
const THUMB_HEIGHT = 37;
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const stamp = (at: number) => timeFormatter.format(at);
export function paintFilmstrip(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  layout: FilmstripLayout,
  viewportWidth: number,
  left: number,
  selectedId: string | undefined,
  thumbnail: (
    id: string,
  ) => { image: CanvasImageSource; width: number; height: number; opacity: number } | undefined,
  center = viewportWidth / 2,
) {
  context.clearRect(0, 0, viewportWidth, 47);
  // Canvas font parsing can resolve document styles. Keep the font in the
  // saved base state instead of assigning it again for every visible card.
  if (context.font !== '500 8px system-ui') context.font = '500 8px system-ui';
  const { start, end } = filmstripRange(layout, left, viewportWidth, 0, center);
  for (let index = start; index < end; index++) {
    const item = layout.items[index];
    const width = layout.widths[index];
    const x = center + layout.offsets[index] - left;
    const y = 5;
    context.save();
    context.beginPath();
    context.roundRect(x, y, width, THUMB_HEIGHT, 7);
    context.clip();
    if (item.type === 'offline') {
      context.fillStyle = 'rgba(255, 255, 255, .025)';
      context.fillRect(x, y, width, THUMB_HEIGHT);
      context.strokeStyle = 'rgba(255, 255, 255, .075)';
      context.lineWidth = 1;
      for (let stripe = -THUMB_HEIGHT; stripe < width + THUMB_HEIGHT; stripe += 8) {
        context.beginPath();
        context.moveTo(x + stripe, y + THUMB_HEIGHT);
        context.lineTo(x + stripe + THUMB_HEIGHT, y);
        context.stroke();
      }
      context.fillStyle = 'rgba(255, 255, 255, .5)';
      context.textAlign = 'center';
      context.fillText('OFFLINE', x + width / 2, y + 21);
    } else {
      const asset = thumbnail(item.event.id);
      const image = asset?.image;
      context.fillStyle = '#26262b';
      context.fillRect(x, y, width, THUMB_HEIGHT);
      if (image && asset && asset.width > 0) {
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        const scale = Math.max(width / asset.width, THUMB_HEIGHT / asset.height);
        const imageWidth = asset.width * scale;
        const imageHeight = asset.height * scale;
        context.save();
        context.globalAlpha = asset?.opacity ?? 1;
        context.drawImage(
          image,
          x + (width - imageWidth) / 2,
          y + (THUMB_HEIGHT - imageHeight) / 2,
          imageWidth,
          imageHeight,
        );
        context.restore();
      } else {
        const gradient = context.createLinearGradient(x, y, x + width, y + THUMB_HEIGHT);
        gradient.addColorStop(0, '#414148');
        gradient.addColorStop(1, '#1b1b20');
        context.fillStyle = gradient;
        context.fillRect(x, y, width, THUMB_HEIGHT);
      }
      context.fillStyle = 'rgba(0, 0, 0, .44)';
      context.fillRect(x, y + THUMB_HEIGHT - 13, width, 13);
      context.fillStyle = '#fff';
      context.textAlign = 'left';
      context.fillText(stamp(item.event.startAt), x + 5, y + THUMB_HEIGHT - 4, width - 10);
    }
    context.restore();
    if (item.type === 'recording') {
      context.save();
      context.translate(x + 7, y + THUMB_HEIGHT / 2);
      context.fillStyle = '#f4f4f4';
      context.beginPath();
      context.arc(0, 0, 7, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = '#343434';
      context.fillStyle = '#343434';
      context.lineWidth = 1.2;
      const kind = item.event.kinds[0];
      if (kind === 'person') {
        context.beginPath();
        context.arc(0, -2, 1.7, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.roundRect(-3, 0, 6, 4, 2);
        context.fill();
      } else if (kind === 'pet') {
        for (const [dx, dy] of [
          [-3, -2],
          [0, -3],
          [3, -2],
        ]) {
          context.beginPath();
          context.arc(dx, dy, 1.2, 0, Math.PI * 2);
          context.fill();
        }
        context.beginPath();
        context.ellipse(0, 1.5, 3, 2, 0, 0, Math.PI * 2);
        context.fill();
      } else if (kind === 'vehicle') {
        context.strokeRect(-4, -1, 8, 4);
        context.beginPath();
        context.moveTo(-3, -1);
        context.lineTo(-2, -3);
        context.lineTo(2, -3);
        context.lineTo(3, -1);
        context.stroke();
      } else {
        context.beginPath();
        context.arc(0, 0, 3, 0, Math.PI * 2);
        context.stroke();
      }
      context.restore();
    }
    if (item.type === 'recording' && selectedId === item.event.id) {
      context.strokeStyle = 'rgba(255, 255, 255, .96)';
      context.lineWidth = 2;
      context.beginPath();
      context.roundRect(x + 1, y + 1, width - 2, THUMB_HEIGHT - 2, 6);
      context.stroke();
    }
  }
}
