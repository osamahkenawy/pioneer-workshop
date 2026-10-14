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
      // A function, so every reconnect sends the token current at that moment
      auth: (cb) => cb({ token: getToken() }),
      autoConnect: true,
    });
    // The server joins the user and workshop rooms from the token itself
    // (lib/socket.js). It never handled the 'join-workshop'/'join-user'
    // events this used to send, so rooms are not chosen by the client.
    socket.on('connect', () => socket.emit('authenticate', { token: getToken() }));
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
