import { WebSocket } from 'k6/experimental/websockets';
import { check, fail, sleep } from 'k6';
import { b64encode } from 'k6/encoding';
import { Counter } from 'k6/metrics';

export const options = {
  vus: 10,
  scenarios: {
    default: {
      executor: 'constant-vus',
      vus: 200,
      duration: '1m',
      gracefulStop: '60s',
    }
  },
};

const REQUESTS_PER_VU = 10;

const testDataDir = 'testdata/';
const samples = [
  {
    data: open(testDataDir + 'sample1.wav', 'b'),
    expectedTranscription: 'The quick brown fox jumped over the lazy dog.',
    duration: 4.74,
  },
  {
    data: open(testDataDir + 'sample1_8khz.wav', 'b'),
    expectedTranscription: 'The quick brown fox jumped over the lazy dog.',
    duration: 4.74,
  },
  {
    data: open(testDataDir + 'sample2.wav', 'b'),
    expectedTranscription: 'How much wood would a wood chuck chuck if a woodchuck could chuck wood?',
    duration: 4.84,
  },
];

const levenshteinDistance = (str1 = '', str2 = '') => {
   const track = Array(str2.length + 1).fill(null).map(() =>
   Array(str1.length + 1).fill(null));
   for (let i = 0; i <= str1.length; i += 1) {
      track[0][i] = i;
   }
   for (let j = 0; j <= str2.length; j += 1) {
      track[j][0] = j;
   }
   for (let j = 1; j <= str2.length; j += 1) {
      for (let i = 1; i <= str1.length; i += 1) {
         const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
         track[j][i] = Math.min(
            track[j][i - 1] + 1, // deletion
            track[j - 1][i] + 1, // insertion
            track[j - 1][i - 1] + indicator, // substitution
         );
      }
   }
   return track[str2.length][str1.length];
};

function normalizeText(text) {
  return text
    .toLowerCase() // Convert to lowercase
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .trim(); // Trim whitespace
}

let txCounter = new Counter('message_tx');
let rxCounter = new Counter('message_rx')
let rx = 0;
let tx = 0;
let err = 0;

export default function () {
  const url = 'ws://localhost:5003/transcribe';
  const params = { headers: { Cookie: `JWT=${__ENV.JWT}` } };

  const socket = new WebSocket(url, null, params);
    socket.onopen = () => {
      for (let i = 0; i < REQUESTS_PER_VU; i++) {
	try {
	  // Randomly select a sample
		//const sample = samples[Math.floor(Math.random() * samples.length)];
		const sample = samples[i % samples.length];

	  // Encode the audio buffer to Base64
	  const audioBase64 = b64encode(sample.data);
	  const payload = JSON.stringify({
	    audio: audioBase64,
	    sequence_id: `${i + 1}`,
	  });

	  // Send the payload
	  socket.send(payload);
	  tx++;

	  // Sleep for the duration of the sample before sending the next request
	  sleep(sample.duration);
	} catch(e) {
	  console.warn(`Send error: ${e}`);
	err++;
	}
      }

      //socket.close(1000, 'test done!');
    };

    socket.onmessage = (data) => {
      rx++;
      const response = JSON.parse(data.data);

      // Find the corresponding sample based on sequence_id
      const sequenceId = parseInt(response.sequence_id) - 1;
      const sample = samples[sequenceId % samples.length];

      // Normalize both expected and actual transcriptions
      const normalizedExpected = normalizeText(sample.expectedTranscription);
      const normalizedActual = normalizeText(response.transcription);

      // Validate the transcription
      check(response, {
        [`Transcription matches expected (normalized) for request ${response.sequence_id}`]: () =>
          //normalizedActual === normalizedExpected,
	  levenshteinDistance(normalizedActual, normalizedExpected) <= 5,
      });
	    if(rx === tx) {
		    socket.close();
	    }

    };

    socket.onclose = (e) => {
      if (e.type !== 'close') {
        console.warn(`⚠️ WebSocket closed abnormally: reason=${JSON.stringify(e)}`);
	err++;
      }
    };

    socket.onerror = (e) => {
      console.warn(`General error: ${JSON.stringify(e)}`);
	    err++;
    };
  
  check({rx,tx}, { ["Packet count matches"]:() => rx === tx,  });
  check(err, { ["Err is 0"]: () => err === 0, });
  rxCounter.add(rx);
  txCounter.add(tx);
}
