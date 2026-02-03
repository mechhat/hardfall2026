from django.db import models


class Event(models.Model):
    name = models.CharField(max_length=200)
    date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date']

    def __str__(self):
        return self.name


class Video(models.Model):
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='videos')
    filename = models.CharField(max_length=255)
    file_path = models.CharField(max_length=500)
    duration_seconds = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    file_size_bytes = models.BigIntegerField(null=True, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.filename


class Action(models.Model):
    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=100)
    points = models.IntegerField()
    ordering = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['ordering']

    def __str__(self):
        return f"{self.code} - {self.name}"


class Analysis(models.Model):
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='analyses')
    video = models.ForeignKey(Video, on_delete=models.CASCADE, related_name='analyses')
    team = models.CharField(max_length=100)
    match = models.CharField(max_length=100)
    notes = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "analyses"

    def __str__(self):
        return f"{self.team} - {self.match}"


class Mark(models.Model):
    analysis = models.ForeignKey(Analysis, on_delete=models.CASCADE, related_name='marks')
    action = models.ForeignKey(Action, on_delete=models.CASCADE, related_name='marks')
    time_seconds = models.DecimalField(max_digits=10, decimal_places=4)
    delta_seconds = models.DecimalField(max_digits=10, decimal_places=4, default=0)
    is_failure = models.BooleanField(default=False)
    count = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def points(self):
        """Calculate points for this mark. Failures get 0 points."""
        if self.is_failure:
            return 0
        return self.action.points * self.count

    def __str__(self):
        status = " (FAIL)" if self.is_failure else ""
        count_str = f" x{self.count}" if self.count > 1 else ""
        return f"{self.action.code}{count_str} @ {self.time_seconds}s{status}"
