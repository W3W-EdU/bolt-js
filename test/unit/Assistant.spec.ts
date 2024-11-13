import type { AssistantThreadStartedEvent } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import { assert } from 'chai';
import rewiremock from 'rewiremock';
import sinon from 'sinon';
import {
  type AllAssistantMiddlewareArgs,
  Assistant,
  type AssistantConfig,
  type AssistantMiddleware,
} from '../../src/Assistant';
import type { AssistantThreadContext, AssistantThreadContextStore } from '../../src/AssistantThreadContextStore';
import { AssistantInitializationError, AssistantMissingPropertyError } from '../../src/errors';
import { autoAcknowledge } from '../../src/middleware/builtin';
import type { Middleware } from '../../src/types';
import {
  type Override,
  createDummyAppMentionEventMiddlewareArgs,
  createDummyAssistantMessageChangedEventMiddlewareArgs,
  createDummyAssistantThreadContextChangedEventMiddlewareArgs,
  createDummyAssistantThreadStartedEventMiddlewareArgs,
  createDummyAssistantUserMessageEventMiddlewareArgs,
  createDummyMessageChangedEventMiddlewareArgs,
  createDummyMessageEventMiddlewareArgs,
  wrapMiddleware,
} from './helpers';

async function importAssistant(overrides: Override = {}): Promise<typeof import('../../src/Assistant')> {
  return rewiremock.module(() => import('../../src/Assistant'), overrides);
}

const MOCK_FN = async () => {};

const MOCK_CONFIG_SINGLE = {
  threadStarted: MOCK_FN,
  threadContextChanged: MOCK_FN,
  userMessage: MOCK_FN,
};

const MOCK_CONFIG_MULTIPLE = {
  threadStarted: [MOCK_FN, MOCK_FN],
  threadContextChanged: [MOCK_FN],
  userMessage: [MOCK_FN, MOCK_FN, MOCK_FN],
};

describe('Assistant class', () => {
  describe('constructor', () => {
    it('should accept config as single functions', async () => {
      const assistant = new Assistant(MOCK_CONFIG_SINGLE);
      assert.isNotNull(assistant);
    });

    it('should accept config as multiple functions', async () => {
      const assistant = new Assistant(MOCK_CONFIG_MULTIPLE);
      assert.isNotNull(assistant);
    });

    describe('validate', () => {
      it('should throw an error if config is not an object', async () => {
        const { validate } = await importAssistant();

        // intentionally casting to AssistantConfig to trigger failure
        const badConfig = '' as unknown as AssistantConfig;

        const validationFn = () => validate(badConfig);
        const expectedMsg = 'Assistant expects a configuration object as the argument';
        assert.throws(validationFn, AssistantInitializationError, expectedMsg);
      });

      it('should throw an error if required keys are missing', async () => {
        const { validate } = await importAssistant();

        // intentionally casting to AssistantConfig to trigger failure
        const badConfig = {
          threadStarted: async () => {},
        } as unknown as AssistantConfig;

        const validationFn = () => validate(badConfig);
        const expectedMsg = 'Assistant is missing required keys: userMessage';
        assert.throws(validationFn, AssistantInitializationError, expectedMsg);
      });

      it('should throw an error if props are not a single callback or an array of callbacks', async () => {
        const { validate } = await importAssistant();

        // intentionally casting to AssistantConfig to trigger failure
        const badConfig = {
          threadStarted: async () => {},
          threadContextChanged: {},
          userMessage: async () => {},
        } as unknown as AssistantConfig;

        const validationFn = () => validate(badConfig);
        const expectedMsg = 'Assistant threadContextChanged property must be a function or an array of functions';
        assert.throws(validationFn, AssistantInitializationError, expectedMsg);
      });
    });
  });

  describe('getMiddleware', () => {
    it('should call next if not an assistant event', async () => {
      const assistant = new Assistant(MOCK_CONFIG_SINGLE);
      const middleware = assistant.getMiddleware();
      const fakeMessageArgs = wrapMiddleware(createDummyMessageEventMiddlewareArgs());
      await middleware(fakeMessageArgs);
      sinon.assert.notCalled(fakeMessageArgs.ack);
      sinon.assert.called(fakeMessageArgs.next);
    });

    it('should not call next if assistant_thread_started_event', async () => {
      const assistant = new Assistant(MOCK_CONFIG_SINGLE);
      const middleware = assistant.getMiddleware();
      const mockThreadStartedArgs = wrapMiddleware(createDummyAssistantThreadStartedEventMiddlewareArgs());
      await middleware(mockThreadStartedArgs);
      sinon.assert.called(mockThreadStartedArgs.ack);
      sinon.assert.notCalled(mockThreadStartedArgs.next);
    });

    it('should not call next if assistant_thread_context_changed_event', async () => {
      const assistant = new Assistant(MOCK_CONFIG_SINGLE);
      const middleware = assistant.getMiddleware();
      const mockThreadStartedArgs = wrapMiddleware(createDummyAssistantThreadContextChangedEventMiddlewareArgs());
      await middleware(mockThreadStartedArgs);
      sinon.assert.called(mockThreadStartedArgs.ack);
      sinon.assert.notCalled(mockThreadStartedArgs.next);
    });

    it('should not call next if assistant_message_event', async () => {
      const assistant = new Assistant(MOCK_CONFIG_SINGLE);
      const middleware = assistant.getMiddleware();
      const mockThreadStartedArgs = wrapMiddleware(createDummyAssistantUserMessageEventMiddlewareArgs());
      await middleware(mockThreadStartedArgs);
      sinon.assert.called(mockThreadStartedArgs.ack);
      sinon.assert.notCalled(mockThreadStartedArgs.next);
    });

    it('should not call next if message changed by assistant event', async () => {
      const assistant = new Assistant(MOCK_CONFIG_SINGLE);
      const middleware = assistant.getMiddleware();
      const mockThreadStartedArgs = wrapMiddleware(createDummyAssistantMessageChangedEventMiddlewareArgs());
      await middleware(mockThreadStartedArgs);
      sinon.assert.called(mockThreadStartedArgs.ack);
      sinon.assert.notCalled(mockThreadStartedArgs.next);
    });

    describe('isAssistantThreadContextChangedEvent', () => {
      it('should return true if recognized assistant_thread_context_changed_event', async () => {
        const mockThreadContextChangedArgs = wrapMiddleware(
          createDummyAssistantThreadContextChangedEventMiddlewareArgs(),
        );
        const { isAssistantThreadContextChangedEvent } = await importAssistant();
        assert(isAssistantThreadContextChangedEvent(mockThreadContextChangedArgs));
      });

      it('should return false if not a recognized assistant_thread_context_changed_event', async () => {
        const fakeMessageArgs = wrapMiddleware(createDummyAppMentionEventMiddlewareArgs());
        const { isAssistantThreadContextChangedEvent } = await importAssistant();
        assert.isFalse(isAssistantThreadContextChangedEvent(fakeMessageArgs));
      });
    });

    describe('isAssistantThreadStartedEvent', () => {
      it('should return true if recognized assistant_thread_started_event', async () => {
        const mockThreadStartedArgs = wrapMiddleware(createDummyAssistantThreadStartedEventMiddlewareArgs());
        const { isAssistantThreadStartedEvent } = await importAssistant();

        assert(isAssistantThreadStartedEvent(mockThreadStartedArgs));
      });

      it('should return false if not a recognized assistant_thread_started_event', async () => {
        const fakeMessageArgs = wrapMiddleware(createDummyAppMentionEventMiddlewareArgs());
        const { isAssistantThreadStartedEvent } = await importAssistant();
        assert.isFalse(isAssistantThreadStartedEvent(fakeMessageArgs));
      });
    });

    describe('isUserMessageEventInAssistantThread', () => {
      it('should return true if assistant_message_event', async () => {
        const mockUserMessageArgs = wrapMiddleware(createDummyAssistantUserMessageEventMiddlewareArgs());
        const { isUserMessageEventInAssistantThread } = await importAssistant();
        assert(isUserMessageEventInAssistantThread(mockUserMessageArgs));
      });

      it('should return false if not correct subtype', async () => {
        const fakeMessageArgs = wrapMiddleware(createDummyMessageEventMiddlewareArgs({ thread_ts: '1234.56' }));
        const { isUserMessageEventInAssistantThread } = await importAssistant();
        assert.isFalse(isUserMessageEventInAssistantThread(fakeMessageArgs));
      });

      it('should return false if thread_ts is missing', async () => {
        const fakeMessageArgs = wrapMiddleware(createDummyMessageEventMiddlewareArgs());
        const { isUserMessageEventInAssistantThread } = await importAssistant();
        assert.isFalse(isUserMessageEventInAssistantThread(fakeMessageArgs));
      });

      it('should return false if channel_type is incorrect', async () => {
        const fakeMessageArgs = wrapMiddleware(createDummyMessageEventMiddlewareArgs({ channel_type: 'mpim' }));
        const { isUserMessageEventInAssistantThread } = await importAssistant();
        assert.isFalse(isUserMessageEventInAssistantThread(fakeMessageArgs));
      });

      it('should return false if not message event', async () => {
        const mockThreadStartedArgs = wrapMiddleware(createDummyAssistantThreadStartedEventMiddlewareArgs());
        const { isUserMessageEventInAssistantThread } = await importAssistant();
        assert.isFalse(isUserMessageEventInAssistantThread(mockThreadStartedArgs));
      });
    });

    describe('isOtherMessageSubEventInAssistantThread', () => {
      it('should return true if message changed by assistant event', async () => {
        const mockUserMessageArgs = wrapMiddleware(createDummyAssistantMessageChangedEventMiddlewareArgs());
        const { isOtherMessageSubEventInAssistantThread } = await importAssistant();
        assert(isOtherMessageSubEventInAssistantThread(mockUserMessageArgs));
      });

      it('should return false if message changed not by assistant event', async () => {
        const mockUserMessageArgs = wrapMiddleware(createDummyMessageChangedEventMiddlewareArgs());
        const { isOtherMessageSubEventInAssistantThread } = await importAssistant();
        assert.isFalse(isOtherMessageSubEventInAssistantThread(mockUserMessageArgs));
      });

      it('should return false if assistant_message_event', async () => {
        const mockUserMessageArgs = wrapMiddleware(createDummyAssistantUserMessageEventMiddlewareArgs());
        const { isOtherMessageSubEventInAssistantThread } = await importAssistant();
        assert.isFalse(isOtherMessageSubEventInAssistantThread(mockUserMessageArgs));
      });

      it('should return false if assistant_thread_started_event', async () => {
        const mockThreadStartedArgs = wrapMiddleware(createDummyAssistantThreadStartedEventMiddlewareArgs());
        const { isOtherMessageSubEventInAssistantThread } = await importAssistant();
        assert.isFalse(isOtherMessageSubEventInAssistantThread(mockThreadStartedArgs));
      });

      it('should return false if assistant_thread_context_changed_event', async () => {
        const mockThreadStartedArgs = wrapMiddleware(createDummyAssistantThreadContextChangedEventMiddlewareArgs());
        const { isOtherMessageSubEventInAssistantThread } = await importAssistant();
        assert.isFalse(isOtherMessageSubEventInAssistantThread(mockThreadStartedArgs));
      });
    });
  });

  describe('processEvent', () => {
    describe('enrichAssistantArgs', () => {
      it('should remove next() from all original event args', async () => {
        const mockThreadStartedArgs = wrapMiddleware(createDummyAssistantThreadStartedEventMiddlewareArgs());
        const mockThreadContextChangedArgs = wrapMiddleware(
          createDummyAssistantThreadContextChangedEventMiddlewareArgs(),
        );
        const mockUserMessageArgs = wrapMiddleware(createDummyAssistantUserMessageEventMiddlewareArgs());
        const mockThreadContextStore = createMockThreadContextStore();

        const { enrichAssistantArgs } = await importAssistant();

        const threadStartedArgs = enrichAssistantArgs(mockThreadContextStore, mockThreadStartedArgs);
        const threadContextChangedArgs = enrichAssistantArgs(mockThreadContextStore, mockThreadContextChangedArgs);
        const userMessageArgs = enrichAssistantArgs(mockThreadContextStore, mockUserMessageArgs);

        assert.notExists(threadStartedArgs.next);
        assert.notExists(threadContextChangedArgs.next);
        assert.notExists(userMessageArgs.next);
      });

      it('should augment assistant_thread_started args with utilities', async () => {
        const { payload } = createDummyAssistantThreadStartedEventMiddlewareArgs();
        const mockThreadContextStore = createMockThreadContextStore();
        const { enrichAssistantArgs } = await importAssistant();
        // TODO: enrichAssistantArgs likely needs a different argument type, as AssistantMiddlewareArgs type already has the assistant utility enrichments present.
        const assistantArgs = enrichAssistantArgs(mockThreadContextStore, {
          payload,
        } as AllAssistantMiddlewareArgs);

        assert.exists(assistantArgs.say);
        assert.exists(assistantArgs.setStatus);
        assert.exists(assistantArgs.setSuggestedPrompts);
        assert.exists(assistantArgs.setTitle);
      });

      it('should augment assistant_thread_context_changed args with utilities', async () => {
        const { payload } = createDummyAssistantThreadContextChangedEventMiddlewareArgs();
        const mockThreadContextStore = createMockThreadContextStore();
        const { enrichAssistantArgs } = await importAssistant();
        // TODO: enrichAssistantArgs likely needs a different argument type, as AssistantMiddlewareArgs type already has the assistant utility enrichments present.
        const assistantArgs = enrichAssistantArgs(mockThreadContextStore, {
          payload,
        } as AllAssistantMiddlewareArgs);

        assert.exists(assistantArgs.say);
        assert.exists(assistantArgs.setStatus);
        assert.exists(assistantArgs.setSuggestedPrompts);
        assert.exists(assistantArgs.setTitle);
      });

      it('should augment message args with utilities', async () => {
        const { payload } = createDummyAssistantUserMessageEventMiddlewareArgs();
        const mockThreadContextStore = createMockThreadContextStore();
        const { enrichAssistantArgs } = await importAssistant();
        // TODO: enrichAssistantArgs likely needs a different argument type, as AssistantMiddlewareArgs type already has the assistant utility enrichments present.
        const assistantArgs = enrichAssistantArgs(mockThreadContextStore, {
          payload,
        } as AllAssistantMiddlewareArgs);

        assert.exists(assistantArgs.say);
        assert.exists(assistantArgs.setStatus);
        assert.exists(assistantArgs.setSuggestedPrompts);
        assert.exists(assistantArgs.setTitle);
      });

      describe('extractThreadInfo', () => {
        it('should return expected channelId, threadTs, and context for `assistant_thread_started` event', async () => {
          const mockThreadStartedArgs = wrapMiddleware(createDummyAssistantThreadStartedEventMiddlewareArgs());
          const { payload } = mockThreadStartedArgs;
          const { extractThreadInfo } = await importAssistant();
          const { channelId, threadTs, context } = extractThreadInfo(payload);

          assert.equal(payload.assistant_thread.channel_id, channelId);
          assert.equal(payload.assistant_thread.thread_ts, threadTs);
          assert.deepEqual(payload.assistant_thread.context, context);
        });

        it('should return expected channelId, threadTs, and context for `assistant_thread_context_changed` event', async () => {
          const mockThreadContextChangedArgs = wrapMiddleware(
            createDummyAssistantThreadContextChangedEventMiddlewareArgs(),
          );
          const { payload } = mockThreadContextChangedArgs;
          const { extractThreadInfo } = await importAssistant();
          const { channelId, threadTs, context } = extractThreadInfo(payload);

          assert.equal(payload.assistant_thread.channel_id, channelId);
          assert.equal(payload.assistant_thread.thread_ts, threadTs);
          assert.deepEqual(payload.assistant_thread.context, context);
        });

        it('should return expected channelId and threadTs for `message` event', async () => {
          const mockUserMessageArgs = wrapMiddleware(createDummyAssistantUserMessageEventMiddlewareArgs());
          const { payload } = mockUserMessageArgs;
          const { extractThreadInfo } = await importAssistant();
          const { channelId, threadTs, context } = extractThreadInfo(payload);

          assert.equal(payload.channel, channelId);
          // @ts-expect-error TODO: AssistantUserMessageMiddlewareArgs extends from too broad of a message event type, which contains types that explicitly DO NOT have a thread_ts. this is at odds with the expectation around assistant user message events.
          assert.equal(payload.thread_ts, threadTs);
          assert.isEmpty(context);
        });

        it('should throw error if `channel_id` or `thread_ts` are missing', async () => {
          const { payload } = wrapMiddleware(createDummyAssistantThreadStartedEventMiddlewareArgs());
          payload.assistant_thread.channel_id = '';
          const { extractThreadInfo } = await importAssistant();

          const extractThreadInfoFn = () => extractThreadInfo(payload);
          const expectedMsg = 'Assistant message event is missing required properties: channel_id';
          assert.throws(extractThreadInfoFn, AssistantMissingPropertyError, expectedMsg);
        });
      });

      describe('assistant args/utilities', () => {
        it('say should call chat.postMessage', async () => {
          const mockThreadStartedArgs = wrapMiddleware(createDummyAssistantThreadStartedEventMiddlewareArgs());

          const fakeClient = { chat: { postMessage: sinon.spy() } };
          mockThreadStartedArgs.client = fakeClient as unknown as WebClient;
          const mockThreadContextStore = createMockThreadContextStore();

          const { enrichAssistantArgs } = await importAssistant();
          const threadStartedArgs = enrichAssistantArgs(mockThreadContextStore, mockThreadStartedArgs);

          await threadStartedArgs.say('Say called!');

          sinon.assert.called(fakeClient.chat.postMessage);
        });

        it('say should be called with message_metadata that includes thread context', async () => {
          const mockThreadStartedArgs = wrapMiddleware(createDummyAssistantThreadStartedEventMiddlewareArgs());

          const fakeClient = { chat: { postMessage: sinon.spy() } };
          mockThreadStartedArgs.client = fakeClient as unknown as WebClient;
          const mockThreadContextStore = createMockThreadContextStore();

          const { enrichAssistantArgs } = await importAssistant();
          const threadStartedArgs = enrichAssistantArgs(mockThreadContextStore, mockThreadStartedArgs);

          await threadStartedArgs.say('Say called!');

          const {
            payload: {
              assistant_thread: { channel_id, thread_ts, context },
            },
          } = mockThreadStartedArgs;

          const expectedParams = {
            text: 'Say called!',
            channel: channel_id,
            thread_ts,
            metadata: {
              event_type: 'assistant_thread_context',
              event_payload: context,
            },
          };

          sinon.assert.calledWith(fakeClient.chat.postMessage, expectedParams);
        });

        it('say should get context from store if no thread context is included in event', async () => {
          const mockThreadStartedArgs = wrapMiddleware(createDummyAssistantThreadStartedEventMiddlewareArgs());
          mockThreadStartedArgs.payload.assistant_thread.context = {};

          const fakeClient = { chat: { postMessage: sinon.spy() } };
          mockThreadStartedArgs.client = fakeClient as unknown as WebClient;
          const mockThreadContextStore = { save: sinon.spy(), get: sinon.spy() };

          const { enrichAssistantArgs } = await importAssistant();
          const threadStartedArgs = enrichAssistantArgs(mockThreadContextStore, mockThreadStartedArgs);

          // Verify that get is not called prior to say being used
          sinon.assert.notCalled(mockThreadContextStore.get);

          await threadStartedArgs.say('Say called!');

          sinon.assert.calledOnce(mockThreadContextStore.get);
        });

        it('setStatus should call assistant.threads.setStatus', async () => {
          const mockThreadStartedArgs = wrapMiddleware(createDummyAssistantThreadStartedEventMiddlewareArgs());

          const fakeClient = { assistant: { threads: { setStatus: sinon.spy() } } };
          mockThreadStartedArgs.client = fakeClient as unknown as WebClient;
          const mockThreadContextStore = createMockThreadContextStore();

          const { enrichAssistantArgs } = await importAssistant();
          const threadStartedArgs = enrichAssistantArgs(mockThreadContextStore, mockThreadStartedArgs);

          await threadStartedArgs.setStatus('Status set!');

          sinon.assert.called(fakeClient.assistant.threads.setStatus);
        });

        it('setSuggestedPrompts should call assistant.threads.setSuggestedPrompts', async () => {
          const mockThreadStartedArgs = wrapMiddleware(createDummyAssistantThreadStartedEventMiddlewareArgs());

          const fakeClient = { assistant: { threads: { setSuggestedPrompts: sinon.spy() } } };
          mockThreadStartedArgs.client = fakeClient as unknown as WebClient;
          const mockThreadContextStore = createMockThreadContextStore();

          const { enrichAssistantArgs } = await importAssistant();
          const threadStartedArgs = enrichAssistantArgs(mockThreadContextStore, mockThreadStartedArgs);

          await threadStartedArgs.setSuggestedPrompts({ prompts: [{ title: '', message: '' }], title: '' });

          sinon.assert.called(fakeClient.assistant.threads.setSuggestedPrompts);
        });

        it('setTitle should call assistant.threads.setTitle', async () => {
          const mockThreadStartedArgs = wrapMiddleware(createDummyAssistantThreadStartedEventMiddlewareArgs());

          const fakeClient = { assistant: { threads: { setTitle: sinon.spy() } } };
          mockThreadStartedArgs.client = fakeClient as unknown as WebClient;
          const mockThreadContextStore = createMockThreadContextStore();

          const { enrichAssistantArgs } = await importAssistant();
          const threadStartedArgs = enrichAssistantArgs(mockThreadContextStore, mockThreadStartedArgs);

          await threadStartedArgs.setTitle('Title set!');

          sinon.assert.called(fakeClient.assistant.threads.setTitle);
        });
      });
    });

    describe('processAssistantMiddleware', () => {
      it('should call each callback in user-provided middleware', async () => {
        const mockThreadContextChangedArgs = wrapMiddleware(
          createDummyAssistantThreadContextChangedEventMiddlewareArgs(),
        );
        const { processAssistantMiddleware } = await importAssistant();

        const fn1 = sinon.spy((async ({ next: continuation }) => {
          await continuation();
        }) as Middleware<AssistantThreadStartedEvent>);
        const fn2 = sinon.spy(async () => {});
        const fakeMiddleware = [autoAcknowledge, fn1, fn2] as AssistantMiddleware;

        await processAssistantMiddleware(mockThreadContextChangedArgs, fakeMiddleware);

        sinon.assert.called(mockThreadContextChangedArgs.ack);
        assert(fn1.called);
        assert(fn2.called);
      });
    });
  });
});

function createMockThreadContextStore(): AssistantThreadContextStore {
  return {
    async get(_: AllAssistantMiddlewareArgs): Promise<AssistantThreadContext> {
      return {};
    },
    async save(_: AllAssistantMiddlewareArgs): Promise<void> {},
  };
}
