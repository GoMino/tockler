import moment from 'moment';
import { backgroundService } from '../background-service';
import BackgroundUtils from '../background-utils';
import { TrackItemType } from '../enums/track-item-type';
import { logManager } from '../log-manager';
import { TrackItem } from '../models/TrackItem';
import { settingsService } from '../services/settings-service';
import { trackItemService } from '../services/track-item-service';
import { stateManager } from '../state-manager';
import { TrackItemRaw } from '../task-analyser';

let logger = logManager.getLogger('LogTrackItemJob');

/**
 *
 *    - Running log item is created manually by user through the tray window
 *    - Running log item can only be stopped by user action
 *    - Running log item is split into new items when system state changes (online/offline/idle)
 *    - Properties (app, title, color) copied from last log item for continuity
 *
 *    Splitting behavior:
 *     - When system state changes (e.g., goes idle), current log item is ended and new log item is created. Running log item id is updated to the new log item.
 */

export class LogTrackItemJob {
    onlineItemWhenLastSplit: TrackItem | null = null;

    async run() {
        try {
            if (this.checkIfIsInCorrectState()) {
                await this.updateRunningLogItem();
            }
        } catch (error: any) {
            logger.error(`Error in LogTrackItemJob: ${error.toString()}`, error);
        }
    }

    checkIfIsInCorrectState() {
        // saveRunningLogItem can be run before app comes back ONLINE and running log item have to be split.
        if (!stateManager.isSystemOnline()) {
            logger.debug('Not online');
            return false;
        }

        if (stateManager.isSystemSleeping()) {
            logger.debug('Computer is sleeping');
            return false;
        }
        return true;
    }

    async updateRunningLogItem() {
        let oldOnlineItem = this.onlineItemWhenLastSplit;
        this.onlineItemWhenLastSplit = stateManager.getCurrentStatusTrackItem();

        let logItemMarkedAsRunning = stateManager.getLogTrackItemMarkedAsRunning();
        if (!logItemMarkedAsRunning) {
            // logger.debug('RUNNING_LOG_ITEM not found.');
            return null;
        }

        let rawItem: TrackItemRaw = BackgroundUtils.getRawTrackItem(logItemMarkedAsRunning as TrackItemRaw);
        rawItem.endDate = new Date();

        let shouldTrySplitting = oldOnlineItem !== this.onlineItemWhenLastSplit;

        if (shouldTrySplitting) {
            let splitEndDate: Date | null = await this.getTaskSplitDate();
            if (splitEndDate) {
                logger.debug('Splitting LogItem, new item has endDate: ', splitEndDate);

                if (logItemMarkedAsRunning.beginDate > splitEndDate) {
                    logger.error('BeginDate is after endDate. Not saving RUNNING_LOG_ITEM');
                    return;
                }

                await stateManager.endRunningTrackItem({
                    endDate: splitEndDate,
                    taskName: TrackItemType.LogTrackItem,
                });

                rawItem.beginDate = BackgroundUtils.currentTimeMinusJobInterval();
            } else {
                // logger.debug('No splitEndDate for item:', rawItem);
            }
        }

        let savedItem = await backgroundService.createOrUpdate(rawItem);
        // at midnight track item is split and new items ID should be RUNNING_LOG_ITEM
        if (savedItem && savedItem.id !== logItemMarkedAsRunning?.id) {
            logger.debug('RUNNING_LOG_ITEM changed.');
            await stateManager.setLogTrackItemMarkedAsRunning(savedItem);
        }

        return savedItem;
    }

    async getTaskSplitDate() {
        let onlineItems = await trackItemService.findLastOnlineItem();
        if (onlineItems && onlineItems.length > 0) {
            let settings = await settingsService.fetchWorkSettings();

            let onlineItem: any = onlineItems[0];
            logger.debug('Online item found:', onlineItem.toJSON());
            let minutesAfterToSplit = settings.splitTaskAfterIdlingForMinutes || 3;
            let minutesFromNow = moment().diff(onlineItem.endDate, 'minutes');

            logger.debug(`Minutes from now:  ${minutesFromNow}, minutesAfterToSplit: ${minutesAfterToSplit}`);

            if (minutesFromNow >= minutesAfterToSplit) {
                let endDate = moment(onlineItem.endDate).add(minutesAfterToSplit, 'minutes').toDate();
                return endDate;
            }
        } else {
            logger.error('No Online items found.');
        }

        return null;
    }
}

export const logTrackItemJob = new LogTrackItemJob();
