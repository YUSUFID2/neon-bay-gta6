// Neon Bay — story text. Original dialogue written for this game.
// No imports, no gameplay code here: just the words. The integrator reads
// text out of STORY by mission index. All text is English, short and punchy.

export const STORY = {
  title: 'NEON BAY',
  tagline: 'Come home. Pay up. Or run.',

  intro: {
    heading: 'BACK IN NEON BAY',
    debt: 'Six jobs. $0 paid. The clock is ticking.',
    lines: [
      'Jax Moreno is back in Neon Bay.',
      'Three years away. Broke. No car. No crew.',
      'One name in his pocket: Rosa — the fixer who runs the bay after dark.',
      'ROSA: "You owe me, Jax. Six jobs. Then we\'re square."',
      'JAX: "Six jobs. Then I\'m gone for good."',
      'ROSA: "Sure you are. First job\'s waiting. Don\'t keep me waiting too."',
    ],
    hint: 'Follow the yellow marker. Finish all six jobs to clear your debt.',
  },

  missionFailed: 'ROSA: "That\'s not how the job goes. Again — and this time, stay alive."',

  missions: [
    {
      id: 'getaway',
      title: 'The Long Way Home',
      brief: 'ROSA: "First job is simple. Take the sedan, lose the tail, and get to the hideout. Don\'t scratch the paint."',
      complete: 'ROSA: "Clean. Maybe you\'re not as rusty as you look."',
      fail: 'ROSA: "You call that driving? Again — slower this time, and alive."',
    },
    {
      id: 'pickup',
      title: 'The Quiet Pickup',
      brief: 'ROSA: "Milo is waiting in Northside with a package the cops want more than we do. Pick him up — then disappear."',
      complete: 'MILO: "You drive like my grandma. But we\'re alive, so thanks."',
      fail: 'ROSA: "Milo got cold feet. The cops got him first. Again."',
    },
    {
      id: 'turf',
      title: 'Turf War',
      brief: 'ROSA: "The Vipers think Old Town is theirs. Go remind them it isn\'t. Loudly."',
      complete: 'ROSA: "Old Town is ours tonight. The Vipers won\'t forget it."',
      fail: 'ROSA: "The Vipers are laughing at us. Go finish it."',
    },
    {
      id: 'heist',
      title: 'Harbor Lights',
      brief: 'ROSA: "A crate at the Harborfront boatyard. No manifest, no questions. Bring it to the Downtown drop."',
      complete: 'ROSA: "Whatever\'s in that crate, it\'s worth more than you. Don\'t ask."',
      fail: 'ROSA: "The crate\'s still sitting there. So is my patience. Again."',
    },
    {
      id: 'bridge',
      title: 'Bridge Run',
      brief: 'ROSA: "Kane\'s crew is waiting on the far side of the bridge. Cross it fast, cross it loud, don\'t stop."',
      complete: 'ROSA: "You crossed the whole bay with half the city behind you. Nice."',
      fail: 'ROSA: "The bridge eats slow drivers. Be faster."',
    },
    {
      id: 'showdown',
      title: 'Harbor Showdown',
      brief: 'ROSA: "Kane is at the harbor. End this, Jax — end all of it."',
      complete: 'ROSA: "Debt\'s paid, Jax. Neon Bay is yours now — if you want it."',
      fail: 'ROSA: "Kane is still breathing. So are you. Fix the first part."',
    },
  ],

  busted: {
    title: 'BUSTED',
    lines: [
      'The cops drag you out of the driver\'s seat.',
      'Hours in a cell. Bail comes out of your pocket.',
      'ROSA: "Bail\'s on your tab, Jax. The job is still waiting."',
    ],
    hint: 'You lost some cash. The mission restarts.',
  },

  wasted: {
    title: 'WASTED',
    lines: [
      'Neon Bay fades to black.',
      'You wake up at St. Mercy Hospital, lighter in the wallet.',
      'ROSA: "You\'re lucky the Vipers can\'t aim. Get back to work."',
    ],
    hint: 'You lost some cash. The mission restarts.',
  },

  outro: {
    heading: 'DEBT PAID',
    lines: [
      'Six jobs. Zero owed.',
      'ROSA: "You\'re free, Jax. Don\'t spend it all in one place."',
      'JAX: "Free? In this city? We\'ll see."',
    ],
    hint: 'Neon Bay is yours now. Free roam, cause chaos, keep the cash.',
  },

  freeRoam: {
    heading: 'NEON BAY IS YOURS',
    lines: [
      'No more jobs. No more debt. Just the city, the cars, and the cops.',
      'ROSA: "If you get bored, you know where to find me."',
    ],
    hint: 'Steal cars, dodge the law, grab taxi fares and hidden packages.',
  },
};

/** Factory required by the module contract: returns the story table. */
export function createStory(state) {
  return STORY;
}
