class BunnyPlayer {
  constructor(video_element) {
    this.video_element = video_element;
    this.media_source = new MediaSource();
    this.video_element.src = URL.createObjectURL(this.media_source);

    // TODO: create class abstracting tracks.
    this.audio_segment = 1;
    this.video_segment = 1;
    this.audio_source = null;
    this.video_source = null;

    // TODO: sanitize?
    // url: path of the directories.
    // buffer: buffer time in seconds.
    this.config = JSON.parse(this.video_element.getAttribute('data-bunny-player-config'));
    this.current_quality = this.config.qualities[0];

    this.media_source.addEventListener('sourceopen', this.onSourceOpen.bind(this));
    this.media_source.addEventListener('sourceclose', this.onSourceClose.bind(this));

    this.interval_id = -1;
  }

  static getSegmentNumber(i) {
    if (i <= 9999) { i = ("000" + i).slice(-4); }
    return i;
  }

  getURLSegment(args) {
    if (args.type != 'audio' && args.type != 'video')
      throw 'invalid type';
    if (args.segment <= 0)
      throw 'invalid segment id';

    var url = this.config.url;
    if (args.type == 'audio')
      url += '/audio/';
    else
      url += '/video/' + this.current_quality + '/';

    return url + BunnyPlayer.getSegmentNumber(args.segment) + '.m4s';
  }

  _fetchAndAppendToSource(url, source_buffer) {
    return fetch(url).then(response => {
      return response.arrayBuffer();
    }).then(data => {
      source_buffer.appendBuffer(data);
    });
  }

  waitNotUpdating() {
    return new Promise(resolver => {
      var id = setInterval(() => {
        if (this.video_source.updating)
          return;
        clearInterval(id);
        resolver();
      }, 100);
    });
  }

  addInitSegment(args) {
    var url = this.config.url;
    if (args.type == 'video') {
      url += '/video/' + this.current_quality + '/init.mp4';
      return this._fetchAndAppendToSource(url, this.video_source);
    }
    url += '/audio/init.mp4';
    return this._fetchAndAppendToSource(url, this.audio_source);
  }

  fetchSegment(args) {
    let before_fetch = new Date();
    let source_buffer = args.type == 'video' ? this.video_source : this.audio_source;
    return this._fetchAndAppendToSource(this.getURLSegment(args), source_buffer).then(() => {
      if (args.type == 'video')
        this.video_segment++;
      else
        this.audio_segment++;

      // Quality update.
      if (args.type == 'video' && this.video_segment > 4) {
        let fetch_time = new Date() - before_fetch;
        if (fetch_time < (this.config.segment_duration * 0.5)) {
          let quality_index = this.config.qualities.indexOf(this.current_quality);
          if ((quality_index + 1) == this.config.qualities.length)
            return;
          this.current_quality = this.config.qualities[quality_index + 1];
        } else if (fetch_time > (this.config.segment_duration * 0.8)) {
          let quality_index = this.config.qualities.indexOf(this.current_quality);
          if (quality_index == 0)
            return;
          this.current_quality = this.config.qualities[quality_index - 1];
        }
        return this.waitNotUpdating().then(() => { this.addInitSegment(args) });
      }
    });
  }

  onSourceOpen() {
    this.audio_source =
        this.media_source.addSourceBuffer(this.config.audio_codec);
    this.video_source =
        this.media_source.addSourceBuffer(this.config.video_codec);

    // Download init segment for the initial quality.
    Promise.all([ this.addInitSegment({ type: 'audio' }),
                  this.addInitSegment({ type: 'video' }) ]).then(() => {
      this.start();
    });
  }

  onSourceClose(e) {
    this.stop();
  }

  maybeAppendChunks() {
    if (this.video_element.buffered.length == 1 &&
        ((this.video_element.buffered.end(0) - this.video_element.currentTime) > this.config.buffer)) {
      return;
    }

    [{ type: 'audio',
       segment: this.audio_segment,
       source: this.audio_source },
     { type: 'video',
       segment: this.video_segment,
       source: this.video_source }].forEach(config => {
      if (config.segment >= this.config.segment_count) {
        this.media_source.endOfStream();
        this.stop();
        return;
      }

      if (config.source.updating)
        return;

      this.fetchSegment({ type: config.type, segment: config.segment });
    });
  }

  start() {
    let self = this;
    this.interval_id = setInterval(() => {
      self.maybeAppendChunks();
    }, 1000);
  }

  stop() {
    clearInterval(this.interval_id);
  }
}

var video_players = [];
document.querySelectorAll('video').forEach(v => {
  if (v.hasAttribute('data-bunny-player-config'))
    video_players.push(new BunnyPlayer(v));
});
