import { useState, useEffect, useRef } from 'react';
import { ref, onValue, serverTimestamp, onDisconnect, set, get, onChildAdded, push } from 'firebase/database';
import { useParams } from 'react-router-dom';
import {
  Box,
  Container,
  Heading,
  VStack,
  HStack,
  Badge
} from "@chakra-ui/react";
import { db, auth, signInAnonymouslyUser } from './firebase';
import VideoGrid from './components/VideoGrid';

type Signal = {
  type: 'offer' | 'answer' | 'candidate';
  from: string;
  sdp: string;
  candidate: RTCIceCandidateInit;
}

type RemoteUser = {
  videoElement?: HTMLVideoElement;
  peerConnection?: RTCPeerConnection;
  cachedIceCandidates?: RTCIceCandidate[];
  cachedSignals?: Signal[];
  peerInitializing?: boolean;
}

export default function App() {
  const [user, setUser] = useState(auth.currentUser);
  const userId = user?.uid;

  const { roomId } = useParams();
  const localRef = useRef<HTMLVideoElement>(null);

  const [iceServersFetched, setIceServersFetched] = useState(false);
  const iceServers = useRef<RTCIceServer[]>([]);

  const [remoteUserIds, setRemoteUserIds] = useState<string[]>([]);
  const remoteUsers = useRef<{ [key: string]: RemoteUser }>({});
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false);

  /* Firebase Database References*/
  const room = roomId || 'default-room';
  const users = 'users';
  const signals = 'signals';

  const roomOccupancyRef = ref(db, [room, users].join('/'));
  const userPresenceRef = ref(db, [room, users, userId].join('/'));
  const userSignalsRef = ref(db, [room, signals, userId].join('/'));

  // Update both state and ref when mute state changes
  const setMuteState = (muted: boolean) => {
    setIsMuted(muted);
    isMutedRef.current = muted;
  };

  // Function to clean up a peer connection
  const cleanupPeerConnection = (remoteUserId: string) => {
    const remoteUser = remoteUsers.current[remoteUserId];
    if (!remoteUser) return;
    console.log('Remote user signals node deleted, cleaning up connection for', remoteUserId);

    if (remoteUser.peerConnection) remoteUser.peerConnection.close();
    if (remoteUser.videoElement) remoteUser.videoElement.srcObject = null;
    delete remoteUsers.current[remoteUserId];
  };

  // Effect to update peer connections when mute state changes
  useEffect(() => {
    Object.values(remoteUsers.current).forEach(remoteUser => {
      remoteUser.peerConnection?.getSenders().forEach(sender => {
        if (sender.track?.kind === 'audio')
          sender.track.enabled = !isMuted;
      });
    });
  }, [isMuted]);

  const getIceServers = async () => {
    const response = await fetch("https://video-chat-63252.metered.live/api/v1/turn/credentials?apiKey=" + import.meta.env.VITE_METERED_API_KEY);
    return await response.json();
  }

  const handleSignal = async (remoteUserId: string, signal: Signal) => {
    const peerConnection = remoteUsers.current[remoteUserId]?.peerConnection;
    const remoteUserSignalRef = ref(db, [room, signals, remoteUserId].join('/'));

    switch (signal.type) {
      case 'offer': {
        // set the remote description, then create an answer and send it to the remote user
        console.log('received offer from', remoteUserId);
        await peerConnection.setRemoteDescription({ type: 'offer', sdp: signal.sdp });

        console.log('sending answer to', remoteUserId);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        await push(remoteUserSignalRef, {
          type: 'answer',
          from: userId,
          sdp: peerConnection.localDescription.sdp
        });

        break;
      }

      case 'answer':
        // set the remote description
        console.log('received answer from', remoteUserId);
        await peerConnection.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
        break;

      case 'candidate':
        if (peerConnection.signalingState === 'stable') {
          // if the connection is stable, add the candidate to the peer connection
          console.log('received candidate from', remoteUserId, '- added to the peer connection');
          await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate))
        } else {
          // if the connection is not stable, cache the candidate for later
          // TODO: is this even necessary if peerConnections can take candidates as soon as they have a local description?
          console.log('received candidate from', remoteUserId, '- cached for later');
          if (!remoteUsers.current[remoteUserId].cachedIceCandidates) {
            remoteUsers.current[remoteUserId].cachedIceCandidates = [];
          }
          remoteUsers.current[remoteUserId].cachedIceCandidates.push(new RTCIceCandidate(signal.candidate));
        }
        break;

      default:
        throw new Error('unknown signal type: ' + signal.type);
    }
  }

  const createPeer = async (remoteUserId: string) => {
    const peerConnection = new RTCPeerConnection({ iceServers: iceServers.current.slice(0, 4) });

    // set up event handlers for the peer connection
    peerConnection.ontrack = (event) => {
      if (remoteUsers.current[remoteUserId]?.videoElement) {
        remoteUsers.current[remoteUserId].videoElement.srcObject = event.streams[0];
      }
    };

    // add a listener for sending gathered ICE candidates to the remote user
    peerConnection.onicecandidate = async (event) => {
      if (event.candidate === null) {
        // all ICE gathering on all transports is complete
        return;
      }

      if (event.candidate.candidate === '') {
        // no further candidates to come in this generation
        return;
      }

      console.log('sending candidate to', remoteUserId);
      const remoteUserSignalRef = ref(db, [room, signals, remoteUserId].join('/'));
      await push(remoteUserSignalRef, {
        type: 'candidate',
        from: userId,
        candidate: event.candidate?.toJSON()
      });
    };

    // once the connection turns stable, process any cached ice candidates
    peerConnection.onsignalingstatechange = () => {
      console.log('signaling state for peer', remoteUserId, 'changed to', peerConnection.signalingState);
      if (peerConnection.signalingState === 'stable' && remoteUsers.current[remoteUserId]?.cachedIceCandidates) {
        remoteUsers.current[remoteUserId].cachedIceCandidates.forEach(async (candidate) => {
          await peerConnection.addIceCandidate(candidate);
        });
      }
    };

    // add local media stream to the peer connection, to prepare for sending an answer
    const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream.getTracks().forEach(track => {
      if (track.kind === 'audio')
        track.enabled = !isMutedRef.current;
      peerConnection.addTrack(track, localStream);
    });

    // Store the peer connection in the remote users ref
    if (!remoteUsers.current[remoteUserId]) {
      remoteUsers.current[remoteUserId] = {};
    }
    remoteUsers.current[remoteUserId].peerConnection = peerConnection;
  }

  /* Initialize asynchronous operations */
  const initialize = async () => {
    // attach local media stream to the local video element
    const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localRef.current!.srcObject = localStream;

    // Get the current user ids from the room occupancy
    const userIds = [...Object.keys((await get(roomOccupancyRef)).val() || {})];
    setRemoteUserIds(userIds.filter(id => id !== userId));

    // Add a listener to monitor changes in room occupancy
    onValue(roomOccupancyRef, (roomOccupancySnapshot) => {
      const currentUsers = roomOccupancySnapshot.val() || {};
      const currentUserIds = Object.keys(currentUsers);
      setRemoteUserIds(currentUserIds.filter(id => id !== userId));

      // Clean up peer connections for users who left the room
      Object.keys(remoteUsers.current).forEach(remoteUserId => {
        if (!currentUserIds.includes(remoteUserId)) {
          cleanupPeerConnection(remoteUserId);
        }
      });

      console.log('room occupancy changed', currentUsers);
    });

    // place the user in the room occupancy object
    // add a listener to the user connection to remove the user + user signals from the room occupancy object
    await set(userPresenceRef, { joined: serverTimestamp() });
    onDisconnect(userPresenceRef).remove();
    onDisconnect(userSignalsRef).remove();

    // add listeners for incoming offers & answers
    onChildAdded(userSignalsRef, async (userSignalSnapshot) => {
      const signal = (userSignalSnapshot.val() || {}) as Signal;
      if (!signal.type) {
        return;
      }
      const remoteUserId = signal.from;

      // if a peer connection for this remote user doesn't yet exist,
      // cache the signal until one is ready
      if (!remoteUsers.current[remoteUserId]?.peerConnection) {
        if (!remoteUsers.current[remoteUserId]) {
          remoteUsers.current[remoteUserId] = {};
        }

        if (!remoteUsers.current[remoteUserId].cachedSignals) {
          remoteUsers.current[remoteUserId].cachedSignals = [];
        }
        remoteUsers.current[remoteUserId].cachedSignals.push(signal);

        // if a peer connection is not already being set up, create one
        // then flush the cached signals
        if (!remoteUsers.current[remoteUserId].peerInitializing) {
          remoteUsers.current[remoteUserId].peerInitializing = true;
          remoteUsers.current[remoteUserId].cachedIceCandidates = [];
          await createPeer(remoteUserId);

          console.log('new peer connection created for', remoteUserId, '- flushing cached signals');
          remoteUsers.current[remoteUserId].cachedSignals.forEach(async (signal) => {
            await handleSignal(remoteUserId, signal);
          });
        }
        return;
      }

      // otherwise, the peer connection already exists, so handle the signal as normal
      await handleSignal(remoteUserId, signal);
    });

    // create a peer connection for each remote user in the room, then send offers to them
    userIds.filter(id => id !== userId).forEach(async (remoteUserId) => {
      const remoteUserSignalRef = ref(db, [room, signals, remoteUserId].join('/'));

      if (!remoteUsers.current[remoteUserId]) {
        remoteUsers.current[remoteUserId] = {};
      }
      remoteUsers.current[remoteUserId].peerInitializing = true;
      remoteUsers.current[remoteUserId].cachedIceCandidates = [];
      await createPeer(remoteUserId);

      const peerConnection = remoteUsers.current[remoteUserId].peerConnection;

      // create an offer and send it to the remote user
      console.log('sending offer to', remoteUserId);
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await push(remoteUserSignalRef, {
        type: 'offer',
        from: userId,
        sdp: peerConnection.localDescription.sdp
      });
    });
  }

  // Handle authentication state
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setUser(user);
      if (!user) {
        // If no user is signed in, sign in anonymously
        signInAnonymouslyUser()
          .then(() => {
            console.log('Anonymous authentication successful');
          })
          .catch(error => {
            console.error('Error signing in anonymously:', error);
          });
      }
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []);

  // Handle ICE servers and initialization
  useEffect(() => {
    if (!iceServersFetched && user) {  // Only proceed if we have a user
      console.log('initializing');
      getIceServers()
        .then(servers => {
          iceServers.current = servers;
          setIceServersFetched(true);
        })
        .then(() => {
          initialize();
        })
        .catch(error => {
          console.error('Error during initialization:', error);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]); // Add user as a dependency

  if (!user) {
    return (
      <Box minH="100vh" bg="gray.50" _dark={{ bg: 'gray.900' }}>
        <Container maxW="container.xl" py={8}>
          <VStack gap={8} align="stretch">
            <Box textAlign="center" py={4}>
              <Heading as="h1" size="xl" mb={2}>Video Chat</Heading>
              <Badge colorScheme="blue" fontSize="md" px={3} py={1} borderRadius="full">
                Connecting...
              </Badge>
            </Box>
          </VStack>
        </Container>
      </Box>
    );
  }

  return (
    <Box minH="100vh" bg="gray.50" _dark={{ bg: 'gray.900' }}>
      <Container maxW="container.xl" py={8}>
        <VStack gap={8} align="stretch">
          {/* Header */}
          <Box textAlign="center" py={4}>
            <Heading as="h1" size="xl" mb={2}>Video Chat</Heading>
            <HStack justify="center" gap={4}>
              <Badge colorScheme="blue" fontSize="md" px={3} py={1} borderRadius="full">
                Room: {room}
              </Badge>
              <Badge colorScheme="green" fontSize="md" px={3} py={1} borderRadius="full">
                Connected: {remoteUserIds.length + 1}
              </Badge>
            </HStack>
          </Box>

          {/* Video Grid */}
          <VideoGrid
            localRef={localRef}
            remoteUserIds={remoteUserIds}
            remoteUsers={remoteUsers.current}
            isMuted={isMuted}
            setIsMuted={setMuteState}
          />
        </VStack>
      </Container>
    </Box>
  );
}