/**
 * socketClient.js — shared Socket.IO connection to the backend.
 * connectSocket(workshopId?) joins the workshop room when provided.
 */
import { io } from 'socket.io-client';
import { getToken } from './api';

let socket = null;

export function connectSocket(workshopId) {
  if (!socket) {
    socket = io('/', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { token: getToken() },
      autoConnect: true,
    });
  }
  if (workshopId) {
    if (socket.connected) socket.emit('join-workshop', workshopId);
    else socket.once('connect', () => socket.emit('join-workshop', workshopId));
  }
  return socket;
}

export function getSocket() {
  return socket || connectSocket();
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
