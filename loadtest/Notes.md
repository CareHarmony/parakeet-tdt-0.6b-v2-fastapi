## Converting m4a to wav for testdata

To create testdata, you can record audio using `Sound Recorder` app on Windows.
The default format appears to be m4a. Install ffmpeg (`chocho install ffmpeg` or `apt install ffmpeg`)
and use the following command to convert:

```bash
ffmpeg -i input.m4a -ar 16000 -ac 1 testdata/sampleX.wav
```
