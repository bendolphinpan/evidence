<script lang="ts">
	import { cn } from '../../../shadcn/utils';
	import { useIntersection } from '../../../useIntersection.svelte';
	import type { UserComponentProps } from '../../types';
	import type { schema } from './schema';

	const props: UserComponentProps<typeof schema> = $props();
	const children = $derived(props.children);

	const { intersectionAction, intersectionState } = useIntersection({ default: true });
	const floating = $derived(!intersectionState.isIntersecting);
</script>

<!-- Zero-size sentinel. Do not give it vertical margin: inside a card that margin renders as an empty header. -->
<div use:intersectionAction aria-hidden="true" class="pointer-events-none h-0 w-0"></div>

<div
	class={cn(
		'sticky top-4 right-0 left-0 z-50 flex flex-row flex-wrap items-center gap-4 rounded-md border transition-all',
		floating ? 'bg-background border-border px-4 pt-3 shadow' : 'border-transparent shadow-none'
	)}
>
	{@render children?.()}
</div>
