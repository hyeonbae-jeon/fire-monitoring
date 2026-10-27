import type {Position} from './map-model';

// Operator-requested correction. Existing saved maps change only on explicit apply.
export const jokduribongUpdate={name:'족두리봉',lat:37.61785,lon:126.94291};
export function approvedPositionUpdate(position:Position){
 return position.name===jokduribongUpdate.name&&(position.lat!==jokduribongUpdate.lat||position.lon!==jokduribongUpdate.lon)?jokduribongUpdate:null;
}
