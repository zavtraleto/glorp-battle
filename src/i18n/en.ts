// All player-facing strings (GDD §0.2). UI code must use t('key'), never literals.

export const en = {
  'game.title': 'GLORP BATTLE',
  'title.start': 'Start',
  'banner.battleStart': 'BATTLE START!',
  'banner.enemyDeleted': 'ENEMY DELETED!',
  'banner.gameOver': 'GAME OVER',
  'banner.paused': 'PAUSED',
  'banner.allClear': 'ALL BATTLES CLEAR!',
  'btn.retry': 'Retry',
  'btn.restart': 'Restart',
  'btn.next': 'Next',
  'btn.resume': 'Resume',
  'btn.buster': 'BUSTER',
  'btn.chip': 'CHIP',
  'btn.custom': 'CUSTOM',
  'custom.ok': 'OK',
  'custom.add': 'ADD',
  'custom.cancel': 'CANCEL',
  'custom.hand': 'Hand',
  'custom.selected': 'Selected',
  'result.time': 'Time',
  'result.hits': 'Hits taken',
  'hud.hp': 'HP',
} as const;

export type StringKey = keyof typeof en;
