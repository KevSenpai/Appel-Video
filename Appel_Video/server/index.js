const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Conformément à SENIOR_ARCHITECTURE_DESIGN.md (gestion des aspects transversaux)
// Activation du middleware CORS pour permettre les requêtes cross-origin depuis le client React.
// En production, l'origine devrait être restreinte à l'URL du frontend.
app.use(cors());

// Conformément à SENIOR_ARCHITECTURE_DESIGN.md et SENIOR_DATABASE_SCHEMA.md
// Utilisation de Map pour la gestion en mémoire des appels et des sockets connectés.
/**
 * @type {Map<string, { createdAt: number, participants: Map<string, { socketId: string, userId: string }>, status: 'active' | 'inactive' }>}
 */
const activeCalls = new Map(); // Stocke les informations sur les appels actifs
/**
 * @type {Map<string, { callId: string, userId: string }>}
 */
const connectedSockets = new Map(); // Mappe les socketId aux callId et userId

// Configuration de Socket.IO pour permettre les connexions depuis le client React
// Conformément à SENIOR_ARCHITECTURE_DESIGN.md (utilisation de Socket.IO)
const io = new Server(server, {
  cors: {
    origin: "*", // Permet toutes les origines pour le développement. À restreindre en production.
    methods: ["GET", "POST"]
  }
});

// Servir les fichiers statiques de l'application cliente React
// Conformément à SENIOR_ARCHITECTURE_DESIGN.md (serveur web pour le frontend)
// app.use(express.static(path.join(__dirname, '../client/build'))); // Servir les fichiers statiques de l'application cliente React

// // Route pour toutes les requêtes non gérées par l'API, renvoie l'application React
// app.get('*', (req, res) => {
//   res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
// });

// Gestion des événements Socket.IO
io.on('connection', (socket) => {
  console.log(`[Socket.IO] Nouvelle connexion: ${socket.id}`);

  // EF-001: Création d'un appel
  socket.on('createCall', (callback) => {
    const callId = nanoid(10); // Génère un ID unique pour l'appel
    const userId = nanoid(8); // Génère un ID unique pour l'utilisateur dans cet appel

    // Initialise l'appel et ajoute le créateur comme premier participant
    activeCalls.set(callId, {
      createdAt: Date.now(),
      participants: new Map([[userId, { socketId: socket.id, userId: userId }]]),
      status: 'active'
    });
    connectedSockets.set(socket.id, { callId: callId, userId: userId });
    socket.join(callId); // L'utilisateur rejoint la "salle" de l'appel

    console.log(`[Call] Appel créé: ${callId} par utilisateur ${userId}`);
    // Retourne l'ID de l'appel et l'ID de l'utilisateur au client
    callback({ callId, userId });
  });

  // EF-003: Rejoindre un appel existant
  socket.on('joinCall', ({ callId }, callback) => {
    const call = activeCalls.get(callId);

    if (!call || call.status === 'inactive') {
      console.log(`[Call] Tentative de rejoindre un appel inexistant ou inactif: ${callId}`);
      return callback({ success: false, message: 'Appel non trouvé ou inactif.' });
    }

    const userId = nanoid(8); // Génère un ID unique pour le nouvel utilisateur
    call.participants.set(userId, { socketId: socket.id, userId: userId });
    connectedSockets.set(socket.id, { callId: callId, userId: userId });
    socket.join(callId); // L'utilisateur rejoint la salle

    console.log(`[Call] Utilisateur ${userId} a rejoint l'appel ${callId}`);

    // Notifie les autres participants de la salle qu'un nouvel utilisateur a rejoint
    socket.to(callId).emit('userJoined', { userId });

    // Retourne l'ID de l'appel et l'ID de l'utilisateur au client
    callback({ success: true, callId, userId });
  });

  // EF-004: Échange de messages de signalisation (SDP, ICE candidates)
  socket.on('signal', ({ recipientUserId, signalData }) => {
    const senderInfo = connectedSockets.get(socket.id);
    if (!senderInfo) {
      console.warn(`[Signal] Expéditeur inconnu pour le signal: ${socket.id}`);
      return;
    }

    const call = activeCalls.get(senderInfo.callId);
    if (!call) {
      console.warn(`[Signal] Appel non trouvé pour l'expéditeur ${senderInfo.userId} dans l'appel ${senderInfo.callId}`);
      return;
    }

    // Trouver le socketId du destinataire
    let recipientSocketId = null;
    for (const [uId, participant] of call.participants.entries()) {
      if (uId === recipientUserId) {
        recipientSocketId = participant.socketId;
        break;
      }
    }

    if (recipientSocketId) {
      // Transmet le signal au destinataire
      io.to(recipientSocketId).emit('signal', {
        senderUserId: senderInfo.userId,
        signalData: signalData
      });
      console.log(`[Signal] Signal de ${senderInfo.userId} à ${recipientUserId} dans l'appel ${senderInfo.callId}`);
    } else {
      console.warn(`[Signal] Destinataire ${recipientUserId} non trouvé dans l'appel ${senderInfo.callId}`);
    }
  });

  // EF-005: Gestion de la déconnexion d'un utilisateur
  socket.on('disconnect', () => {
    const disconnectedUserInfo = connectedSockets.get(socket.id);
    if (disconnectedUserInfo) {
      const { callId, userId } = disconnectedUserInfo;
      const call = activeCalls.get(callId);

      if (call) {
        call.participants.delete(userId); // Retire le participant de l'appel

        // Notifie les autres participants de la salle que l'utilisateur a quitté
        socket.to(callId).emit('userLeft', { userId });
        console.log(`[Call] Utilisateur ${userId} a quitté l'appel ${callId}`);

        // Si l'appel n'a plus de participants, le marque comme inactif
        if (call.participants.size === 0) {
          activeCalls.delete(callId); // Supprime l'appel s'il est vide
          console.log(`[Call] Appel ${callId} terminé (plus de participants).`);
        }
      }
      connectedSockets.delete(socket.id); // Retire le socket des connexions actives
    }
    console.log(`[Socket.IO] Déconnexion: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Serveur de signalisation démarré sur le port ${PORT}`);
  console.log(`Accédez à l'application via http://localhost:${PORT}`);
});