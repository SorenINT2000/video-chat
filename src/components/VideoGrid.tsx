import type { RefObject } from 'react';
import {
  Grid,
  GridItem,
  Box,
  Text,
  VStack,
  Center,
  AspectRatio,
  IconButton,
  HStack
} from "@chakra-ui/react";
import { CiMicrophoneOn, CiMicrophoneOff } from "react-icons/ci";

type RemoteUser = {
  videoElement?: HTMLVideoElement;
  peerConnection?: RTCPeerConnection;
  cachedIceCandidates?: RTCIceCandidate[];
  cachedSignals?: Signal[];
  peerInitializing?: boolean;
}

type Signal = {
  type?: 'offer' | 'answer' | 'candidate';
  from?: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
}

interface VideoGridProps {
  localRef: RefObject<HTMLVideoElement>;
  remoteUserIds: string[];
  remoteUsers: { [key: string]: RemoteUser };
  isMuted: boolean;
  setIsMuted: (muted: boolean) => void;
}

export default function VideoGrid({ localRef, remoteUserIds, remoteUsers, isMuted, setIsMuted }: VideoGridProps) {
  return (
    <Grid
      templateColumns={{
        base: "1fr",
        md: "repeat(2, 1fr)",
        lg: "repeat(3, 1fr)"
      }}
      gap={6}
    >
      {/* Local Video */}
      <GridItem>
        <Box
          bg="white"
          _dark={{ bg: 'gray.800' }}
          rounded="xl"
          shadow="lg"
          overflow="hidden"
        >
          <AspectRatio ratio={16 / 9}>
            <video
              ref={localRef}
              autoPlay
              muted
              style={{
                objectFit: 'contain',
                width: '100%',
                height: '100%',
                backgroundColor: 'black',
                transform: 'scaleX(-1)'
              }}
            />
          </AspectRatio>
          <HStack justify="space-between" align="center" gap={2} p={4} h="68px">
            <Text fontWeight="bold" fontSize="lg">You (Local)</Text>
            <IconButton
              aria-label={isMuted ? "Unmute" : "Mute"}
              onClick={() => setIsMuted(!isMuted)}
              color={isMuted ? "red" : "blue"}
              size="sm"
            >
              {isMuted ? <CiMicrophoneOff /> : <CiMicrophoneOn />}
            </IconButton>
          </HStack>
        </Box>
      </GridItem>

      {/* Remote Videos */}
      {
        remoteUserIds.map(remoteId => (
          <GridItem key={remoteId}>
            <Box
              bg="white"
              _dark={{ bg: 'gray.800' }}
              rounded="xl"
              shadow="lg"
              overflow="hidden"
            >
              <AspectRatio ratio={16 / 9}>
                <video
                  ref={(el) => {
                    if (!remoteUsers[remoteId]) {
                      remoteUsers[remoteId] = {};
                    }
                    remoteUsers[remoteId].videoElement = el;
                  }}
                  autoPlay
                  style={{
                    objectFit: 'contain',
                    width: '100%',
                    height: '100%',
                    backgroundColor: 'black'
                  }}
                />
              </AspectRatio>
              <HStack justify="space-between" align="center" gap={2} p={4} h={68}>
                <Text fontWeight="bold" fontSize="lg">
                  User {remoteId}
                </Text>
              </HStack>
            </Box>
          </GridItem>
        ))
      }

      {/* Empty State */}
      {
        remoteUserIds.length === 0 && (
          <GridItem colSpan={{ base: 1, md: 2, lg: 3 }}>
            <Center
              bg="white"
              _dark={{ bg: 'gray.800' }}
              rounded="xl"
              shadow="lg"
              p={8}
              minH="200px"
            >
              <VStack gap={4}>
                <Text fontSize="xl" color="gray.500">
                  Waiting for others to join...
                </Text>
                <Text fontSize="sm" color="gray.400">
                  Share the room link to invite others
                </Text>
              </VStack>
            </Center>
          </GridItem>
        )
      }
    </Grid >
  );
} 