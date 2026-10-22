import text from './data/bukhansan-map.json?raw';
import {parseMapBundle} from './map-layers';

// User-approved public map data for the Pages website. Normal Bridge builds
// retain central configuration and synthetic fallback; Vite removes this data.
export const publishedMap=import.meta.env.VITE_MAP_ONLY==='true'?parseMapBundle(text):null;
