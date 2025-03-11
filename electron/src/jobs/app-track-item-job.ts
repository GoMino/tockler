import activeWin from 'active-win';
import { backgroundService } from '../background-service';
import BackgroundUtils from '../background-utils';
import { TrackItemType } from '../enums/track-item-type';
import { logManager } from '../log-manager';
import { stateManager } from '../state-manager';
import { taskAnalyser, TrackItemRaw } from '../task-analyser';

import activeWindow from 'active-win';
import { TrackItem } from '../drizzle/schema';

let logger = logManager.getLogger('AppTrackItemJob');

const errorWindowItem: activeWindow.Result = {
    platform: 'macos',
    title: 'Active Window undefined',
    owner: {
        name: 'PERMISSION_ERROR',
        processId: 0,
        path: '',
        bundleId: '',
    },
    id: 0,
    bounds: {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
    },
    memoryUsage: 0,
};

export class AppTrackItemJob {
    lastUpdatedItem: TrackItem | null = null;
    errorDialogIsOpen = false;

    async run() {
        if (this.errorDialogIsOpen) {
            logger.debug('Not running appTrackItemJob. Error dialog is open.');
            return false;
        }

        try {
            if (this.checkIfIsInCorrectState()) {
                let activeWindow = await activeWin();
                let updatedItem: TrackItem = await this.saveActiveWindow(activeWindow ?? errorWindowItem);

                if (this.lastUpdatedItem && updatedItem) {
                    if (
                        !BackgroundUtils.isSameItems(
                            BackgroundUtils.getRawTrackItem(updatedItem),
                            BackgroundUtils.getRawTrackItem(this.lastUpdatedItem),
                        )
                    ) {
                        logger.debug('App and title changed. Analysing title');
                        taskAnalyser.analyseAndNotify(BackgroundUtils.getRawTrackItem(updatedItem)).then(
                            () => logger.debug('Analysing has run.'),
                            (e) => logger.error('Error in Analysing', e),
                        );
                    }
                }

                this.lastUpdatedItem = updatedItem;
            } else {
                logger.debug('App not in correct state');
                return false;
            }

            return true;
        } catch (error: any) {
            logger.error(`Error in AppTrackItemJob: ${error.toString()}`, error);
            let updatedItem: TrackItem = await this.saveActiveWindow({ ...errorWindowItem, title: error.toString() });
            this.lastUpdatedItem = updatedItem;
        }

        return false;
    }

    checkIfIsInCorrectState() {
        if (stateManager.isSystemSleeping()) {
            stateManager.resetAppTrackItem();
            logger.debug('System is sleeping.');
            return false;
        }

        if (stateManager.isSystemIdling()) {
            stateManager.resetAppTrackItem();
            logger.debug('App is idling.');
            return false;
        }
        return true;
    }

    async saveActiveWindow(result: activeWindow.Result): Promise<TrackItem> {
        let rawItem: Partial<TrackItemRaw> = { taskName: TrackItemType.AppTrackItem };

        rawItem.beginDate = BackgroundUtils.currentTimeMinusJobInterval();
        rawItem.endDate = Date.now();

        if (result.owner && result.owner.name) {
            rawItem.app = result.owner.name;
        } else {
            rawItem.app = 'NATIVE';
        }

        if (!result.title) {
            rawItem.title = 'NO_TITLE';
        } else {
            rawItem.title = result.title.replace(/\n$/, '').replace(/^\s/, '');
        }

        let savedItem = await backgroundService.createOrUpdate(rawItem);
        return savedItem as TrackItem;
    }
}

export const appTrackItemJob = new AppTrackItemJob();
