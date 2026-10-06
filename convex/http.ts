import { httpRouter } from 'convex/server';
import { auth } from './auth';
import { upload, preflight } from './chatUploads';
import { upload as proofUpload, preflight as proofPreflight } from './deliveryProofs';
import { upload as runnerPhotoUpload, preflight as runnerPhotoPreflight } from './runnerPhotos';

const http = httpRouter();
auth.addHttpRoutes(http);
http.route({ path: '/chat/image', method: 'POST', handler: upload });
http.route({ path: '/chat/image', method: 'OPTIONS', handler: preflight });
http.route({ path: '/delivery/photo', method: 'POST', handler: proofUpload });
http.route({ path: '/delivery/photo', method: 'OPTIONS', handler: proofPreflight });
http.route({ path: '/runner/photo', method: 'POST', handler: runnerPhotoUpload });
http.route({ path: '/runner/photo', method: 'OPTIONS', handler: runnerPhotoPreflight });
export default http;
