/**
 * Scene list for the documentation screenshots.
 *
 * Each scene is: a name (which becomes docs/images/<name>.png), an optional
 * `setup` snippet run inside the renderer to put the UI in the right state, and
 * an optional `clip` selector to crop to one element instead of the whole
 * window. Scenes run in order against a single window and the harness closes
 * any open modal between them.
 */

module.exports = [
  {
    name: 'main-window',
    // The default view: 16 channels, DCA colors, meters, two mutes and a solo.
    setup: `if (typeof setLevelVisibility === 'function') await setLevelVisibility('meter');`,
    settle: 700,
  },
  {
    // Paired with the numbered legend in docs/index.html — keep the callout
    // numbers and that list in step.
    name: 'main-window-annotated',
    setup: `if (typeof setLevelVisibility === 'function') await setLevelVisibility('meter');`,
    settle: 700,
    annotate: [
      // Anchored to the empty space beside each region's own content so the
      // badges never cover a control the legend is pointing at.
      { n: 1, selector: '.header-left', x: 1, dx: 45 },          // header bar
      { n: 2, selector: '.faders-toolbar', x: 0.5, dx: -70 },    // toolbar
      { n: 3, selector: '#faders-container', x: 0.5, y: 0.42 },  // channel strips
      { n: 4, selector: '.status-bar-left', x: 1, dx: 45 },      // status bar
    ],
  },
  {
    name: 'toolbar',
    // The app header: transport, profile buttons, MIDI/mixer status, mode lock.
    clip: '.header',
    pad: 4,
  },
  {
    name: 'mute-groups',
    clip: '.faders-toolbar',
    pad: 4,
  },
  {
    name: 'channel-strip',
    // The first four strips, close up: instrument icon, meter, mute/solo,
    // and the name / DCA / mapping badges underneath.
    clip: '#faders-container',
    pad: 6,
    crop: { children: 4 },
  },
  {
    name: 'mixer-discovery',
    setup: `if (typeof showDiscovery === 'function') await showDiscovery();`,
    clip: '#discovery-modal .modal-content',
    settle: 600,
  },
  {
    name: 'mapping-modal',
    setup: `if (typeof showAddMapping === 'function') showAddMapping();`,
    clip: '#add-mapping-modal .modal-content',
    settle: 500,
  },
  {
    name: 'midi-modal',
    setup: `if (typeof showMidiSelect === 'function') showMidiSelect();`,
    clip: '#midi-select-modal .modal-content',
    settle: 600,
  },
  {
    name: 'mappings-list',
    setup: `if (typeof showMappingsList === 'function') await showMappingsList();`,
    clip: '#mappings-list-modal .modal-content',
    settle: 600,
  },
  {
    // Filename matches the reference already in docs/index.html.
    name: 'preferences-modal',
    setup: `
      if (typeof showPreferences === 'function') showPreferences();
      // showPreferences reads module state rather than the IPC value, so mirror
      // the meter mode the main-window shot is captured in.
      const sel = document.getElementById('level-visibility-select');
      if (sel) sel.value = 'meter';
      const peak = document.getElementById('peak-hold-check');
      if (peak) peak.checked = true;
    `,
    clip: '#preferences-modal .modal-content',
    settle: 500,
  },
  {
    name: 'context-menus',
    // Right-clicking a fader, mute, or solo button offers to edit, learn, or
    // clear that control's mapping. The menus are static markup, so showing one
    // beats synthesizing a contextmenu event at the right coordinates.
    setup: `
      const menu = document.getElementById('fader-context-menu');
      menu.classList.add('show');
      menu.style.position = 'absolute';
      menu.style.left = '24px';
      menu.style.top = '24px';
    `,
    clip: '#fader-context-menu',
    pad: 4,
    settle: 300,
  },
];
