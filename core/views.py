import hashlib
import json
import mimetypes

from django.conf import settings
from django.db import transaction
from django.http import FileResponse, JsonResponse
from django.shortcuts import render, redirect, get_object_or_404
from django.views.decorators.http import require_http_methods, require_POST

from .models import Event, Video, Analysis, Action, Mark

# Video magic bytes for validation
VIDEO_SIGNATURES = {
    b'\x00\x00\x00\x14ftyp': 'mp4',  # MP4/M4V (ftyp at offset 4)
    b'\x00\x00\x00\x18ftyp': 'mp4',  # MP4 variant
    b'\x00\x00\x00\x1cftyp': 'mp4',  # MP4 variant
    b'\x00\x00\x00\x20ftyp': 'mp4',  # MP4 variant
    b'\x1aE\xdf\xa3': 'webm',  # WebM/MKV
    b'RIFF': 'avi',  # AVI (need to also check for AVI at offset 8)
    b'\x00\x00\x01\xba': 'mpg',  # MPEG
    b'\x00\x00\x01\xb3': 'mpg',  # MPEG
    b'\x1aE\xdf\xa3': 'mkv',  # MKV
}

ALLOWED_EXTENSIONS = {'mp4', 'm4v', 'mov', 'avi', 'webm', 'mkv', 'mpg', 'mpeg'}


def _validate_video_file(file_content):
    """
    Validate that file content is a video by checking magic bytes.
    Returns (is_valid, detected_extension).
    """
    if len(file_content) < 12:
        return False, None

    header = file_content[:32]

    # Check for ftyp-based formats (MP4, MOV, M4V)
    # ftyp can appear at different offsets
    for offset in [4, 8]:
        if len(header) > offset + 4 and header[offset:offset+4] == b'ftyp':
            # Check specific brand for MOV vs MP4
            brand = header[offset+4:offset+8]
            if brand == b'qt  ':
                return True, 'mov'
            return True, 'mp4'

    # WebM/MKV
    if header[:4] == b'\x1aE\xdf\xa3':
        return True, 'webm'

    # AVI
    if header[:4] == b'RIFF' and header[8:12] == b'AVI ':
        return True, 'avi'

    # MPEG
    if header[:4] in (b'\x00\x00\x01\xba', b'\x00\x00\x01\xb3'):
        return True, 'mpg'

    return False, None


def event_list(request):
    events = Event.objects.all()
    return render(request, 'core/event_list.html', {'events': events})


@require_http_methods(["GET", "POST"])
def event_create(request):
    if request.method == 'POST':
        name = request.POST.get('name')
        date = request.POST.get('date')
        if name and date:
            Event.objects.create(name=name, date=date)
            return redirect('event_list')
    return render(request, 'core/event_create.html')


def event_detail(request, event_id):
    event = get_object_or_404(Event, pk=event_id)
    analyses = event.analyses.order_by('-match')

    # Videos linked to an analysis for this event
    linked_video_ids = analyses.values_list('video_id', flat=True)
    unlinked_videos = event.videos.exclude(id__in=linked_video_ids)

    return render(request, 'core/event_detail.html', {
        'event': event,
        'analyses': analyses,
        'unlinked_videos': unlinked_videos,
    })


def video_detail(request, video_id):
    video = get_object_or_404(Video, pk=video_id)
    return render(request, 'core/video_detail.html', {'video': video})


def video_serve(request, video_id):
    video = get_object_or_404(Video, pk=video_id)
    file_path = settings.VIDEOS_ROOT / video.file_path
    content_type, _ = mimetypes.guess_type(str(file_path))
    return FileResponse(open(file_path, 'rb'), content_type=content_type or 'video/mp4')


def analysis_detail(request, analysis_id):
    analysis = get_object_or_404(Analysis, pk=analysis_id)

    marks_data = [
        {
            'id': mark.id,
            'action_id': mark.action_id,
            'action_code': mark.action.code,
            'time_seconds': float(mark.time_seconds),
            'delta_seconds': float(mark.delta_seconds),
            'is_failure': mark.is_failure,
            'count': mark.count,
        }
        for mark in analysis.marks.select_related('action').order_by('time_seconds')
    ]

    actions_data = [
        {
            'id': action.id,
            'code': action.code,
            'name': action.name,
            'points': action.points,
        }
        for action in Action.objects.all()
    ]

    return render(request, 'core/analysis_detail.html', {
        'analysis': analysis,
        'marks_json': json.dumps(marks_data),
        'actions_json': json.dumps(actions_data),
    })


@require_POST
def analysis_create(request, video_id):
    video = get_object_or_404(Video, pk=video_id)
    team = request.POST.get('team', '').strip()
    match = request.POST.get('match', '').strip()

    if team and match:
        analysis = Analysis.objects.create(
            event=video.event,
            video=video,
            team=team,
            match=match,
        )
        return redirect('analysis_detail', analysis_id=analysis.id)

    return redirect('video_detail', video_id=video_id)


@require_POST
def analysis_save_marks(request, analysis_id):
    analysis = get_object_or_404(Analysis, pk=analysis_id)

    try:
        data = json.loads(request.body)
        marks_data = data.get('marks', [])
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    # Validate all action IDs exist
    action_ids = {m['action_id'] for m in marks_data}
    existing_actions = set(Action.objects.filter(id__in=action_ids).values_list('id', flat=True))
    if action_ids and action_ids != existing_actions:
        return JsonResponse({'error': 'Invalid action ID'}, status=400)

    # Sort marks by time and compute delta_seconds
    sorted_marks = sorted(marks_data, key=lambda m: m['time_seconds'])
    prev_time = 0
    for mark_data in sorted_marks:
        mark_data['delta_seconds'] = mark_data['time_seconds'] - prev_time
        prev_time = mark_data['time_seconds']

    # Delete existing marks and create new ones
    with transaction.atomic():
        analysis.marks.all().delete()

        new_marks = [
            Mark(
                analysis=analysis,
                action_id=mark_data['action_id'],
                time_seconds=mark_data['time_seconds'],
                delta_seconds=mark_data['delta_seconds'],
                is_failure=mark_data.get('is_failure', False),
                count=mark_data.get('count', 1),
            )
            for mark_data in sorted_marks
        ]
        Mark.objects.bulk_create(new_marks)

    # Return saved marks with their database IDs
    saved_marks = [
        {
            'id': mark.id,
            'action_id': mark.action_id,
            'action_code': mark.action.code,
            'time_seconds': float(mark.time_seconds),
            'delta_seconds': float(mark.delta_seconds),
            'is_failure': mark.is_failure,
            'count': mark.count,
        }
        for mark in analysis.marks.select_related('action').order_by('time_seconds')
    ]

    return JsonResponse({'success': True, 'marks': saved_marks})


@require_POST
def video_upload(request, event_id):
    event = get_object_or_404(Event, pk=event_id)

    uploaded_file = request.FILES.get('video')
    filename = request.POST.get('filename', '').strip()

    if not uploaded_file:
        return JsonResponse({'error': 'No video file provided'}, status=400)

    if not filename:
        return JsonResponse({'error': 'No filename provided'}, status=400)

    # Read file content for validation and hashing
    file_content = uploaded_file.read()

    # Validate it's actually a video file
    is_valid, detected_ext = _validate_video_file(file_content)
    if not is_valid:
        return JsonResponse({'error': 'Invalid video file format'}, status=400)

    # Compute SHA256 hash of file content
    file_hash = hashlib.sha256(file_content).hexdigest()

    # Build storage path using event date
    date_path = event.date.strftime('%Y/%m/%d')
    storage_dir = settings.VIDEOS_ROOT / date_path
    storage_dir.mkdir(parents=True, exist_ok=True)

    # Use hash and detected extension for filename
    storage_filename = f'{file_hash}.{detected_ext}'
    storage_path = storage_dir / storage_filename

    # Write file to disk
    with open(storage_path, 'wb') as f:
        f.write(file_content)

    # Store path relative to VIDEOS_ROOT
    relative_path = f'{date_path}/{storage_filename}'

    # Create Video record
    video = Video.objects.create(
        event=event,
        filename=filename,
        file_path=relative_path,
        file_size_bytes=len(file_content),
    )

    return JsonResponse({
        'success': True,
        'video_id': video.id,
        'redirect_url': f'/events/{event_id}',
    })
