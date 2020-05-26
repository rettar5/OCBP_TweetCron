import { Log, OdnUtils } from '../../../odnUtils';
import { AccountConfigs, AccountData } from '../../../configs/accountConfigs';
import { OdnPlugins } from '../../../odnPlugins';
import { OdnTweetData, OdnTweets } from '../../../odnTweets';

export class TweetCron {
  constructor(
    private accountData: AccountData,
    private nowDate: Date,
    private fullName: string
  ) {}

  /**
   * プラグインのメイン処理を実行
   *
   * @param {(isProcessed?: boolean) => void} finish
   */
  run(finish: (isProcessed?: boolean) => void) {
    const all = TweetCron.getStoredAllSchedules(
      TweetCronConstats.PLUGIN_FULL_NAME,
      this.accountData.userId
    );
    Object.values(all)
      .filter((data: SerializedScheduleAndCommand) => {
        const schedule = new TweetCronSchedule().deserialize(data.schedule);
        return schedule.isMatch(this.nowDate);
      })
      .forEach(data => this.postCommand(data));

    finish();
  }

  /**
   * コマンドの内容を投稿
   *
   * @param data
   */
  private postCommand(data: SerializedScheduleAndCommand): void {
    const schedule = new TweetCronSchedule().deserialize(data.schedule);
    const tweets = new OdnTweets(this.accountData);
    tweets.text = data.command;
    tweets.postTweet((isSuccess, error) => {
      if (isSuccess) {
        Log.d(`cron executed! ${schedule.encodeUnixCronOption()}`);
      } else {
        Log.e('error: ', error, JSON.stringify(data));
      }
    });
  }

  /**
   * プラグインを実行するかどうか判定
   *
   * @param accountData
   * @param nowDate
   * @returns {boolean}
   */
  static isValid(accountData: AccountData, nowDate: Date): boolean {
    // 毎分実行のため常にtrue
    return true;
  }

  /**
   * 保存済みのすべてのスケジュールを取得
   *
   * @param pluginFullName
   * @param userId
   */
  private static getStoredAllSchedules(
    pluginFullName: string,
    userId: string
  ): { string: SerializedScheduleAndCommand } {
    return OdnPlugins.getStoredData(pluginFullName, userId) || {};
  }

  /**
   * すべてのスケジュールを保存
   *
   * @param pluginFullName
   * @param userId
   * @param schedules
   */
  private static setAllSchedules(
    pluginFullName: string,
    userId: string,
    schedules: { string: SerializedScheduleAndCommand }
  ): void {
    OdnPlugins.setStoredData(pluginFullName, userId, schedules);
  }

  /**
   * ツイート投稿を予約
   *
   * @param userId
   * @param date
   * @param message
   * @returns {number}
   */
  static addSchedule(
    userId: string,
    schedule: TweetCronSchedule,
    command: string
  ): number {
    const all = TweetCron.getStoredAllSchedules(
      TweetCronConstats.PLUGIN_FULL_NAME,
      userId
    );
    const nextIdx = Math.max(...Object.keys(all).map(s => parseInt(s)), 0) + 1;
    all[nextIdx.toString()] = {
      schedule: schedule.serialize(),
      command: command
    };
    TweetCron.setAllSchedules(TweetCronConstats.PLUGIN_FULL_NAME, userId, all);
    return nextIdx;
  }

  /**
   * 予約済みの投稿を削除
   *
   * @param userId
   * @param reservedNumber
   * @returns {boolean}
   */
  static removeSchedule(userId: string, reservedNumber: number): boolean {
    const all = TweetCron.getStoredAllSchedules(
      TweetCronConstats.PLUGIN_FULL_NAME,
      userId
    );
    const commandNum = Object.keys(all).length;
    delete all[reservedNumber.toString()];
    TweetCron.setAllSchedules(TweetCronConstats.PLUGIN_FULL_NAME, userId, all);
    return commandNum !== Object.keys(all).length;
  }
}

namespace TweetCronConstats {
  export const PLUGIN_FULL_NAME = 'PluginsBatchTweetCron';
}

type SerializedScheduleAndCommand = {
  schedule: string;
  command: string;
};

export class TweetCronSchedule implements Serializable {
  min?: string;
  hour?: string;
  day?: string;
  mon?: string;
  week?: string;
  private availableKeys = ['min', 'hour', 'day', 'mon', 'week'];

  constructor(data?: OdnTweetData) {
    if (data?.text) {
      const [_, __, ___, mi, ho, da, mo, we] = data.text.split(' ');
      this.min = mi;
      this.hour = ho;
      this.day = da;
      this.mon = mo;
      this.week = we;
    }
  }

  /**
   * 指定されている日時が正しい値か
   */
  isValidSchedule(): boolean {
    return Boolean(this.min && this.hour && this.day && this.mon && this.week);
  }

  /**
   * スケジュールがdateと一致するか
   *
   * @param date
   */
  isMatch(date: Date): boolean {
    return (
      this.isMinMatch(date) &&
      this.isHourMatch(date) &&
      this.isDayMatch(date) &&
      this.isMonMatch(date) &&
      this.isWeekMatch(date)
    );
  }

  private isMinMatch(d: Date): boolean {
    return this.isWildCard(this.min) || parseInt(this.min) === d.getMinutes();
  }

  private isHourMatch(d: Date): boolean {
    return this.isWildCard(this.hour) || parseInt(this.hour) === d.getHours();
  }

  private isDayMatch(d: Date): boolean {
    return this.isWildCard(this.day) || parseInt(this.day) === d.getDate();
  }

  private isMonMatch(d: Date): boolean {
    return this.isWildCard(this.mon) || parseInt(this.mon) === d.getMonth() + 1;
  }

  private isWeekMatch(d: Date): boolean {
    return this.isWildCard(this.week) || parseInt(this.week) === d.getDay();
  }

  private isWildCard(str: string): boolean {
    return str === '*' || str === '＊';
  }

  serialize(): string {
    const obj = {};
    this.availableKeys.forEach(k => (obj[k] = this[k]));
    return JSON.stringify(obj);
  }

  deserialize(data: string): this {
    try {
      const parsed = JSON.parse(data);
      this.availableKeys.forEach(k => {
        this[k] = parsed[k];
      });
    } catch (e) {
      Log.w(e);
    }
    return this;
  }

  encodeUnixCronOption(): string {
    return `${this.min} ${this.hour} ${this.day} ${this.mon} ${this.week}`;
  }
}

abstract class Serializable {
  abstract serialize(): string;
  abstract deserialize(data: string): this;
}
