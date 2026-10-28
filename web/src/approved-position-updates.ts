import type {Position} from './map-model';

// Operator-requested correction. Existing saved maps change only on explicit apply.
export const jokduribongUpdate={name:'족두리봉',lat:37.61785,lon:126.94291};
export const bohyeonbongUpdate={name:'보현봉',lat:37.62838,lon:126.97420};
const updates=[jokduribongUpdate,bohyeonbongUpdate];
export function approvedPositionUpdate(position:Position){
 return updates.find(update=>position.name===update.name&&(position.lat!==update.lat||position.lon!==update.lon))??null;
}
