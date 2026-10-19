import homepodMini from '../assets/brands/homepod-mini.svg?raw';
import homepod from '../assets/brands/homepod.svg?raw';
import nestHub from '../assets/brands/nest-hub.svg?raw';
import nestMini from '../assets/brands/nest-mini.svg?raw';
import nestAudio from '../assets/brands/nest-audio.svg?raw';
import google from '../assets/brands/google-logo-circle.svg?raw';
import appleTv from '../assets/brands/apple-tv-logo.svg?raw';
import fireTv from '../assets/brands/firetv.svg?raw';
import eero from '../assets/brands/eero-logo.svg?raw';
import type { HausAccessory } from './types';
export function mediaArtwork(accessory: HausAccessory) {
  if (
    accessory.category === 'network' &&
    /eero/i.test(`${accessory.manufacturer ?? ''} ${accessory.model ?? ''}`)
  )
    return eero;
  if (!accessory.primaryEntityId.startsWith('media_player.')) return undefined;
  const model = String(accessory.model ?? '');
  const label = `${model} ${accessory.manufacturer ?? ''} ${accessory.name}`;
  if (/home\s*pod/i.test(label)) return /mini/i.test(model) ? homepodMini : homepod;
  if (/apple\s*tv|tvos/i.test(label)) return appleTv;
  if (/fire\s*tv|\bAFT[A-Z0-9]+\b/i.test(label)) return fireTv;
  if (/google|\bnest\b/i.test(label)) {
    if (/nest\s*hub/i.test(model)) return nestHub;
    if (/(?:home|nest)\s*mini/i.test(model)) return nestMini;
    if (/nest\s*audio/i.test(model)) return nestAudio;
    return google;
  }
  return undefined;
}
